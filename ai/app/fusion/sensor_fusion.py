"""Evidence fusion with explicit freshness and missing-modality handling."""
import logging
from dataclasses import dataclass, field
from datetime import datetime

from ..schemas.prediction import AnomalyResult
from ..schemas.sensor import SensorSample
from ..schemas.vision import VisionResult

logger = logging.getLogger("FUSION")


@dataclass
class FusedEvidence:
    intrusion_score: int = 0
    environmental_score: int = 0
    correlated_environment: bool = False
    sensor_anomaly: bool = False
    confidence: float = 0.0
    degraded: bool = False
    reasons: list[str] = field(default_factory=list)


def fuse(sample: SensorSample | None, anomaly: AnomalyResult, vision: VisionResult,
         now: datetime, sensor_stale_seconds: float = 30, vision_stale_seconds: float = 5) -> FusedEvidence:
    evidence = FusedEvidence()
    sensor_age = (now - sample.timestamp).total_seconds() if sample else float("inf")
    sensor_fresh = -5 <= sensor_age <= sensor_stale_seconds
    vision_age = (now - (vision.last_prediction_time or vision.timestamp)).total_seconds()
    vision_fresh = (vision.status == "running" and vision.detection_status in (None, "running")
                    and -5 <= vision_age <= vision_stale_seconds)
    pir = sensor_fresh and sample is not None and sample.presence is True
    person = vision_fresh and vision.confirmed and vision.person_detected
    if sensor_fresh and anomaly.status == "ready":
        evidence.confidence = anomaly.confidence or 0
    if pir and person:
        evidence.intrusion_score = round(80 + 15 * vision.max_confidence)
        evidence.confidence = min(1.0, 0.5 + 0.5 * vision.max_confidence)
        evidence.reasons += ["Person detected by camera (confirmed)", "PIR sensor active"]
        logger.info("PIR + YOLO confirmed")
    elif person:
        evidence.intrusion_score = round(55 + 20 * vision.max_confidence)
        evidence.confidence = vision.max_confidence * 0.85
        evidence.reasons.append("Person confirmed by vision without PIR confirmation")
    elif pir:
        evidence.intrusion_score = 35
        evidence.confidence = 0.35
        evidence.reasons.append("PIR movement without camera confirmation")

    if sensor_fresh and anomaly.status == "ready" and anomaly.is_anomaly:
        features = anomaly.features
        # Environmental prediction originates in ML; direction adds context, not a fixed sensor threshold.
        evidence.correlated_environment = (
            not {"temperature", "gas"}.intersection(anomaly.missing_fields)
            and features.get("temp_delta", 0) > 0 and features.get("gas_delta", 0) > 0
        )
        evidence.sensor_anomaly = True
        evidence.environmental_score = round(45 + 40 * (anomaly.anomaly_score or 0))
        evidence.confidence = max(evidence.confidence, anomaly.confidence or 0)
        evidence.reasons.append(anomaly.reason)
        if evidence.correlated_environment:
            evidence.environmental_score = min(100, evidence.environmental_score + 10)
            evidence.reasons.append("Gas/temperature correlation detected by temporal features")

    unavailable = []
    if not sensor_fresh:
        unavailable.append("Sensor data missing or stale")
    elif anomaly.status != "ready":
        unavailable.append(anomaly.reason)
    elif anomaly.missing_fields:
        unavailable.append("Missing sensor fields: " + ", ".join(anomaly.missing_fields))
    if not vision_fresh:
        unavailable.append("Vision unavailable or stale")
    evidence.degraded = bool(unavailable)
    evidence.reasons += unavailable
    if not evidence.reasons:
        evidence.reasons = ["No threat detected by available modalities"]
    return evidence
