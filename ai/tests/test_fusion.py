from datetime import timedelta

import pytest

from app.fusion.risk_engine import evaluate, risk_level
from app.fusion.sensor_fusion import fuse
from app.schemas.prediction import AnomalyResult
from app.schemas.sensor import SensorSample, utc_now
from app.schemas.vision import VisionResult


def normal(now):
    return AnomalyResult(status="ready", is_anomaly=False, anomaly_score=0.1, confidence=0.8,
                         reason="Normal", timestamp=now)


def test_pir_and_confirmed_vision_fusion():
    now = utc_now()
    sample = SensorSample(temperature=23, humidity=50, gas=140, presence=True, timestamp=now)
    vision = VisionResult(status="running", person_detected=True, person_count=1,
                          max_confidence=0.91, confirmed=True, timestamp=now)
    result = evaluate(fuse(sample, normal(now), vision, now), now)
    assert result.category == "INTRUSION" and result.risk_score >= 90
    assert not result.degraded
    vision.confirmed = False
    result = evaluate(fuse(sample, normal(now), vision, now), now)
    assert result.risk_level == "LOW" and result.risk_score == 35
    sample.presence = False
    vision.confirmed = True
    assert evaluate(fuse(sample, normal(now), vision, now), now).risk_level == "MEDIUM"


def test_ml_correlation_and_multiple_threats():
    now = utc_now()
    sample = SensorSample(temperature=27, gas=210, presence=True, timestamp=now)
    anomaly = AnomalyResult(status="ready", is_anomaly=True, anomaly_score=0.9, confidence=0.8,
                            reason="Correlated drift", features={"temp_delta": 0.2, "gas_delta": 2}, timestamp=now)
    evidence = fuse(sample, anomaly, VisionResult(), now)
    assert evaluate(evidence, now).category == "MULTI_THREAT"
    sample.presence = False
    result = evaluate(fuse(sample, anomaly, VisionResult(), now), now)
    assert result.category == "ENVIRONMENT" and result.risk_score >= 90
    anomaly.features["gas_delta"] = 0
    assert evaluate(fuse(sample, anomaly, VisionResult(), now), now).category == "SENSOR_ANOMALY"
    anomaly.is_anomaly = False
    assert evaluate(fuse(sample, anomaly, VisionResult(), now), now).risk_score == 0


def test_stale_vision_and_sensor_evidence_are_ignored():
    now = utc_now()
    old = now - timedelta(seconds=60)
    sample = SensorSample(presence=True, timestamp=old)
    vision = VisionResult(status="running", confirmed=True, person_detected=True, max_confidence=0.9, timestamp=old)
    result = evaluate(fuse(sample, normal(old), vision, now), now)
    assert result.risk_score == 0 and result.degraded
    assert any("stale" in reason for reason in result.reasons)


@pytest.mark.parametrize("detection_status", ["loading", "unavailable", "error"])
def test_raw_video_does_not_count_as_detection_evidence(detection_status):
    now = utc_now()
    sample = SensorSample(presence=False, timestamp=now)
    vision = VisionResult(status="running", stream_ready=True, detection_status=detection_status,
                          confirmed=True, person_detected=True, max_confidence=.9, timestamp=now)
    result = evaluate(fuse(sample, normal(now), vision, now), now)
    assert result.risk_score == 0 and result.degraded


def test_fresh_video_does_not_refresh_old_person_evidence():
    now = utc_now()
    vision = VisionResult(status="running", stream_ready=True, detection_status="running",
                          confirmed=True, person_detected=True, max_confidence=.9, timestamp=now,
                          last_frame_time=now, last_prediction_time=now - timedelta(seconds=60))
    result = evaluate(fuse(SensorSample(presence=False, timestamp=now), normal(now), vision, now), now)
    assert result.risk_score == 0 and result.degraded


@pytest.mark.parametrize("presence,score", [(False, 0), (True, 35)])
def test_simulated_sensors_are_never_correlated_with_real_camera(presence, score):
    now = utc_now()
    sample = SensorSample(temperature=23, humidity=50, gas=140, presence=presence,
                          source="simulation", timestamp=now)
    vision = VisionResult(status="running", detection_status="running", confirmed=True,
                          person_detected=True, person_count=1, max_confidence=.99, timestamp=now)
    result = evaluate(fuse(sample, normal(now), vision, now), now)
    assert result.risk_score == score and result.degraded
    assert any("Simulation" in reason for reason in result.reasons)
    assert not any("Person detected by camera" in reason for reason in result.reasons)


def test_invalid_climate_channel_degrades_analysis_but_valid_modalities_still_work():
    now = utc_now()
    sample = SensorSample(temperature=81, humidity=50, gas=140, presence=True, timestamp=now)
    vision = VisionResult(status="running", detection_status="running", confirmed=True,
                          person_detected=True, max_confidence=.9, timestamp=now)
    result = evaluate(fuse(sample, normal(now), vision, now), now)
    assert result.risk_score >= 90 and result.degraded
    assert any("temperature outside" in reason for reason in result.reasons)


@pytest.mark.parametrize("score,level", [(0,"SAFE"),(24,"SAFE"),(25,"LOW"),(49,"LOW"),
                                        (50,"MEDIUM"),(74,"MEDIUM"),(75,"HIGH"),(89,"HIGH"),
                                        (90,"CRITICAL"),(100,"CRITICAL")])
def test_risk_boundaries(score, level):
    assert risk_level(score) == level
