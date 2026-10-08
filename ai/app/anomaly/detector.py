import logging
from pathlib import Path

import numpy as np

from ..schemas.prediction import AnomalyResult
from ..schemas.sensor import SensorSample
from .model_manager import load_model
from .preprocessing import BASE_FEATURES, FeatureExtractor, feature_vector

logger = logging.getLogger("AI")


class AnomalyDetector:
    def __init__(self, model_path: Path):
        self.model_path = model_path
        self.artifact: dict | None = None
        self.extractor: FeatureExtractor | None = None
        self.simulation_extractor: FeatureExtractor | None = None
        self.error: str | None = None
        self.reload()

    @property
    def loaded(self) -> bool:
        return self.artifact is not None

    def reload(self) -> bool:
        self.artifact, self.error = load_model(self.model_path)
        self.extractor = FeatureExtractor(self.artifact["medians"], self.artifact["window"]) if self.artifact else None
        self.simulation_extractor = FeatureExtractor(self.artifact["medians"], self.artifact["window"]) if self.artifact else None
        return self.loaded

    def predict(self, sample: SensorSample) -> AnomalyResult:
        missing = [name for name in BASE_FEATURES if getattr(sample, name) is None]
        quality = "; ignored invalid sensor fields: " + ", ".join(sample.quality_issues) if sample.quality_issues else ""
        if len(missing) == len(BASE_FEATURES):
            return AnomalyResult(status="insufficient_data", reason="No sensor values received" + quality,
                                 missing_fields=missing, timestamp=sample.timestamp)
        if not self.artifact or not self.extractor:
            return AnomalyResult(status="untrained", reason=(self.error or "Model not trained") + quality,
                                 missing_fields=missing, timestamp=sample.timestamp)
        try:
            extractor = self.simulation_extractor if sample.source == "simulation" else self.extractor
            features, missing = extractor.extract(sample)
            decision = float(self.artifact["model"].decision_function(feature_vector(features))[0])
            is_anomaly = decision < 0
            # 0.5 is the model's learned decision boundary; this is not a probability.
            score = float(1 / (1 + np.exp(np.clip(decision / self.artifact["decision_scale"], -30, 30))))
            confidence = abs(score - 0.5) * 2 * (1 - len(missing) / len(BASE_FEATURES))
            deviations = {name: abs(value - self.artifact["baseline_mean"][name]) /
                          self.artifact["baseline_std"][name] for name, value in features.items()}
            strongest = sorted(deviations, key=deviations.get, reverse=True)[:3]
            reason = "Normal sensor evolution"
            if is_anomaly:
                reason = "Abnormal sensor evolution: " + ", ".join(strongest)
                if features["temp_delta"] > 0 and features["gas_delta"] > 0 and not {"temperature", "gas"}.intersection(missing):
                    reason = "Abnormal temperature/gas evolution (correlated rise)"
            if missing:
                reason += "; imputed missing fields: " + ", ".join(missing)
            reason += quality
            logger.info("anomaly score=%.3f anomaly=%s", score, is_anomaly)
            return AnomalyResult(status="ready", is_anomaly=is_anomaly, anomaly_score=round(score, 4),
                                 confidence=round(confidence, 4), reason=reason, features=features,
                                 missing_fields=missing, timestamp=sample.timestamp)
        except Exception as error:
            logger.exception("Anomaly inference failed")
            return AnomalyResult(status="error", reason=str(error), missing_fields=missing,
                                 timestamp=sample.timestamp)
