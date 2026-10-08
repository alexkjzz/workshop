"""Chronology, channel quality and simulation isolation without physical devices."""
from datetime import timedelta
from unittest.mock import Mock

import pytest

from app.config import Settings
from app.schemas.sensor import SensorSample, utc_now
from app.schemas.vision import VisionResult
from app.service import AiEngine
from app import service as module


@pytest.fixture
def engine_clock(tmp_path, monkeypatch):
    clock = {"now": utc_now()}
    monkeypatch.setattr(module, "utc_now", lambda: clock["now"])
    engine = AiEngine(Settings(model_path=tmp_path / "missing.joblib", face_enabled=False,
                               vision_auto_start=False))
    engine.vision = VisionResult(timestamp=clock["now"])
    return engine, clock


def camera(now):
    return VisionResult(status="running", detection_status="running", confirmed=True,
                        person_detected=True, person_count=1, max_confidence=.9,
                        timestamp=now, last_prediction_time=now)


def test_old_observation_cannot_replace_latest_or_advance_inference(engine_clock, monkeypatch):
    engine, clock = engine_clock
    now = clock["now"]
    engine.update_vision(camera(now))
    first = engine.analyze(SensorSample(sample_id=10, temperature=24, presence=False, timestamp=now))
    predict = Mock(wraps=engine.detector.predict)
    monkeypatch.setattr(engine.detector, "predict", predict)
    replay = engine.analyze(SensorSample(sample_id=9, temperature=70, presence=True,
                                        timestamp=now - timedelta(seconds=1)))
    assert replay.sample_id == 9 and replay.source == "live"
    assert replay.anomaly.status == "insufficient_data" and replay.risk.degraded
    assert "precedes" in replay.anomaly.reason
    assert replay.risk.risk_score < 90  # The replay's PIR is not fused with the camera.
    assert engine.sample.sample_id == 10 and engine.sample.temperature == 24
    latest = engine.status()["latest_prediction"]
    assert latest.sample_id == first.sample_id and latest.risk.risk_score == first.risk.risk_score
    predict.assert_not_called()


@pytest.mark.parametrize("seconds,reason", [(-31, "stale"), (6, "future")])
def test_stale_and_future_samples_do_not_poison_current_state(engine_clock, seconds, reason):
    engine, clock = engine_clock
    now = clock["now"]
    engine.analyze(SensorSample(sample_id=1, gas=40, timestamp=now))
    result = engine.analyze(SensorSample(sample_id=2, gas=900,
                                        timestamp=now + timedelta(seconds=seconds)))
    assert result.sample_id == 2 and result.anomaly.status == "insufficient_data"
    assert reason in result.anomaly.reason and result.risk.degraded
    assert engine.status()["latest_prediction"].sample_id == 1
    clock["now"] += timedelta(seconds=1)
    accepted = engine.analyze(SensorSample(sample_id=3, gas=41, timestamp=clock["now"]))
    assert accepted.sample_id == 3 and engine.sample.gas == 41


def test_coarse_equal_timestamps_accept_distinct_ids_but_not_replays(engine_clock):
    engine, clock = engine_clock
    now = clock["now"].replace(microsecond=0)
    engine.analyze(SensorSample(sample_id=1, gas=40, timestamp=now))
    second = engine.analyze(SensorSample(sample_id=2, gas=50, timestamp=now))
    assert second.anomaly.status == "untrained" and engine.sample.gas == 50
    replay = engine.analyze(SensorSample(sample_id=2, gas=900, timestamp=now))
    assert "duplicate" in replay.anomaly.reason and engine.sample.gas == 50
    replay = engine.analyze(SensorSample(sample_id=1, gas=900, timestamp=now))
    assert replay.anomaly.status == "insufficient_data" and engine.sample.sample_id == 2


def test_duplicate_without_id_is_ignored_but_distinct_content_is_accepted(engine_clock):
    engine, clock = engine_clock
    sample = SensorSample(gas=40, timestamp=clock["now"])
    engine.analyze(sample)
    assert "duplicate" in engine.analyze(sample).anomaly.reason
    assert engine.analyze(SensorSample(gas=41, timestamp=sample.timestamp)).anomaly.status == "untrained"
    assert engine.sample.gas == 41


def test_simulation_has_no_real_camera_and_cannot_replace_fresh_live_state(engine_clock):
    engine, clock = engine_clock
    now = clock["now"]
    engine.update_vision(camera(now))
    live = engine.analyze(SensorSample(sample_id=1, presence=False, gas=40, timestamp=now))
    clock["now"] += timedelta(seconds=1)
    simulation = engine.analyze(SensorSample(sample_id=2, source="simulation", presence=True,
                                            gas=900, timestamp=clock["now"]))
    assert simulation.source == "simulation" and simulation.sample_id == 2
    assert simulation.vision.status == "stopped" and not simulation.vision.person_detected
    assert simulation.risk.risk_score == 35 and simulation.risk.degraded
    assert any("Simulation" in reason for reason in simulation.risk.reasons)
    status = engine.status()
    assert status["vision"].status == "running"
    assert status["latest_prediction"].sample_id == live.sample_id
    assert status["latest_prediction"].source == "live"
    # Simulation timestamp does not order the separate physical sensor sequence.
    next_live = engine.analyze(SensorSample(sample_id=3, gas=41, timestamp=clock["now"]))
    assert next_live.source == "live" and engine.sample.sample_id == 3


def test_simulation_remains_usable_when_no_fresh_live_observation_exists(engine_clock):
    engine, clock = engine_clock
    now = clock["now"]
    engine.update_vision(camera(now))
    engine.analyze(SensorSample(sample_id=1, gas=40, timestamp=now))
    clock["now"] += timedelta(seconds=31)
    result = engine.analyze(SensorSample(sample_id=2, source="simulation", presence=True,
                                        timestamp=clock["now"]))
    assert result.source == "simulation" and engine.status()["latest_prediction"].source == "simulation"
    engine.update_vision(camera(clock["now"]))
    assert not engine.status()["latest_prediction"].vision.person_detected
    assert engine.status()["vision"].person_detected


def test_invalid_channels_have_explicit_reasons_and_do_not_erase_valid_pir_gas(engine_clock):
    engine, clock = engine_clock
    result = engine.analyze(SensorSample(sample_id=1, temperature=81, humidity=-1, gas=630,
                                        presence=True, timestamp=clock["now"]))
    assert engine.sample.temperature is None and engine.sample.humidity is None
    assert engine.sample.gas == 630 and engine.sample.presence is True
    assert result.anomaly.status == "untrained" and result.risk.risk_score == 35
    assert result.anomaly.missing_fields == ["temperature", "humidity"]
    assert "temperature outside" in result.anomaly.reason and "humidity outside" in result.anomaly.reason
    assert result.risk.degraded


def test_future_vision_does_not_block_later_valid_camera_updates(engine_clock):
    engine, clock = engine_clock
    now = clock["now"]
    engine.update_vision(camera(now + timedelta(seconds=60)))
    assert engine.status()["vision"].status == "stopped"
    engine.update_vision(camera(now))
    assert engine.status()["vision"].status == "running"


def test_engine_owns_sample_snapshot(engine_clock):
    engine, clock = engine_clock
    sample = SensorSample(gas=40, timestamp=clock["now"])
    engine.analyze(sample)
    sample.gas = 900
    assert engine.sample.gas == 40
