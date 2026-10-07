from datetime import timedelta

import numpy as np
import pytest
from pydantic import ValidationError

from app.anomaly.detector import AnomalyDetector
from app.anomaly.preprocessing import BASE_FEATURES, FEATURE_NAMES, FeatureExtractor
from app.anomaly.trainer import read_samples, train
from app.schemas.sensor import SensorSample, utc_now
from app.simulator import drift_samples, normal_samples, write_training


@pytest.fixture(scope="module")
def model_path(tmp_path_factory):
    path = tmp_path_factory.mktemp("model") / "isolation.joblib"
    train(normal_samples(1200), path)
    return path


def test_temporal_features_and_missing_values():
    extractor = FeatureExtractor(dict(zip(BASE_FEATURES, [23, 52, 140, 0])), window=3)
    now = utc_now()
    first, _ = extractor.extract(SensorSample(temperature=23, humidity=50, gas=140, presence=False, timestamp=now))
    second, missing = extractor.extract(SensorSample(temperature=24, gas=150, presence=True, timestamp=now + timedelta(seconds=2)))
    assert list(second) == list(FEATURE_NAMES)
    assert first["temp_delta"] == 0
    assert second["temp_delta"] == 1 and second["gas_delta"] == 10
    assert second["temp_rate"] == 0.5 and second["temp_mean"] == 23.5
    assert missing == ["humidity"] and np.isfinite(list(second.values())).all()
    reset, _ = extractor.extract(SensorSample(temperature=24, gas=150, timestamp=now + timedelta(seconds=60)))
    assert reset["temp_delta"] == 0


def test_missing_channel_does_not_invent_correlated_rise():
    extractor = FeatureExtractor(dict(zip(BASE_FEATURES, [23, 52, 140, 0])))
    now = utc_now()
    extractor.extract(SensorSample(temperature=20, gas=100, timestamp=now))
    features, _ = extractor.extract(SensorSample(gas=150, timestamp=now + timedelta(seconds=2)))
    assert features["temp_delta"] == 0


def test_normal_and_progressive_drift_use_real_model(model_path):
    detector = AnomalyDetector(model_path)
    normal = [detector.predict(sample) for sample in normal_samples(400, seed=7)]
    assert sum(result.is_anomaly for result in normal) / len(normal) < 0.15
    drift = [detector.predict(sample) for sample in drift_samples(40)]
    early = [result for result in drift if result.is_anomaly and result.features["temperature"] < 30
             and result.features["gas"] < 300]
    assert early, "Temporal ML must identify drift before the illustrative fixed thresholds"
    assert all(0 <= result.anomaly_score <= 1 for result in drift)
    assert drift[-1].is_anomaly


def test_reload_and_missing_model_are_explicit(model_path, tmp_path):
    detector = AnomalyDetector(tmp_path / "missing.joblib")
    result = detector.predict(SensorSample(temperature=23))
    assert result.status == "untrained" and result.is_anomaly is None and result.anomaly_score is None
    trained = AnomalyDetector(model_path)
    assert trained.loaded and trained.reload()
    result = trained.predict(SensorSample(gas=140))
    assert result.status == "ready" and len(result.missing_fields) == 3
    assert result.confidence <= 0.25
    assert trained.predict(SensorSample()).status == "insufficient_data"


def test_csv_training_requires_sufficient_observed_data(tmp_path):
    csv = tmp_path / "normal.csv"
    write_training(csv, 150)
    assert len(read_samples(csv)) == 150
    with pytest.raises(ValueError, match="128"):
        train(normal_samples(20), tmp_path / "model.joblib")


def test_reject_nonfinite_and_invalid_presence():
    with pytest.raises(ValidationError):
        SensorSample(temperature=float("nan"))
    with pytest.raises(ValidationError):
        SensorSample(presence=2)
    assert SensorSample(presence=1).presence is True
