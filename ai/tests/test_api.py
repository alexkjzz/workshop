from datetime import timedelta

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas.sensor import SensorSample, utc_now
from app.schemas.vision import DetectedObject, VisionResult


def test_health_without_backend_model_camera_or_yolo(tmp_path):
    api = create_app(Settings(model_path=tmp_path / "missing.joblib", yolo_model=tmp_path / "missing.pt"))
    with TestClient(api) as client:
        health = client.get("/health")
        assert health.status_code == 200 and health.json()["model_loaded"] is False
        assert client.get("/status").json()["latest_prediction"] is None
        result = client.post("/analyze", json={"temperature":23,"gas":140,"presence":0}).json()
        assert result["anomaly"]["status"] == "untrained"
        assert result["risk"]["degraded"] is True
        assert client.get("/risk/latest").status_code == 200
        assert client.get("/stream.mjpg").status_code == 503
        assert client.post("/vision/stop").json()["status"] == "stopped"
        assert client.post("/analyze", json={"temperature":"invalid"}).status_code == 422
        assert client.post("/model/reload").json() == {"model_loaded": False}


def test_shared_token_and_person_object_alias(tmp_path):
    api = create_app(Settings(model_path=tmp_path / "missing", service_token="test-token"))
    with TestClient(api) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/status").status_code == 401
        assert client.post("/analyze", json={"gas":140}).status_code == 401
        assert client.get("/vision/status").status_code == 401
        assert client.get("/stream.mjpg").status_code == 401
        assert client.post("/vision/start").status_code == 401
        assert client.post("/vision/stop").status_code == 401
        headers = {"Authorization": "Bearer test-token"}
        assert client.get("/status", headers=headers).status_code == 200
        assert client.get("/vision/status", headers=headers).json()["status"] == "stopped"
        assert client.get("/stream.mjpg", headers=headers).status_code == 503
        api.state.engine.update_vision(VisionResult(status="running", person_detected=True, confirmed=True,
            person_count=1, max_confidence=.9, objects=[DetectedObject(confidence=.9,bbox=[1,2,3,4])]))
        result = client.get("/status", headers=headers).json()
        assert result["vision"]["objects"][0]["class"] == "person"


def test_camera_only_event_and_expiring_sensor_evidence(tmp_path):
    api = create_app(Settings(model_path=tmp_path / "missing"))
    engine = api.state.engine
    vision = VisionResult(status="running", person_detected=True, confirmed=True, person_count=1, max_confidence=.9)
    engine.update_vision(vision)
    assert engine.status()["latest_prediction"].risk.category == "INTRUSION"
    engine.analyze(SensorSample(presence=True, timestamp=utc_now() - timedelta(seconds=60)))
    assert engine.status()["latest_prediction"].risk.risk_score < 90
    engine.update_vision(VisionResult(status="stopped"))
    assert engine.status()["latest_prediction"].risk.risk_score == 0
