"""Coordinates ordered sensor inference and asynchronous server-camera updates."""
import logging
from datetime import datetime
from threading import RLock

from .anomaly.detector import AnomalyDetector
from .config import Settings
from .fusion.risk_engine import evaluate
from .fusion.sensor_fusion import FusedEvidence, fuse
from .schemas.prediction import AiPrediction, AnomalyResult
from .schemas.sensor import FUTURE_TOLERANCE_SECONDS, SensorSample, utc_now
from .schemas.vision import VisionResult
from .vision.camera import CameraService

logger = logging.getLogger("AI")


class AiEngine:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.lock = RLock()
        self.detector = AnomalyDetector(settings.model_path)
        self.sample: SensorSample | None = None
        self.anomaly = AnomalyResult(status="insufficient_data", reason="No sensor data received")
        self.vision = VisionResult()
        self.latest: AiPrediction | None = None
        self._last_samples: dict[str, SensorSample] = {}
        self.camera = CameraService(settings, on_update=self.update_vision)

    def analyze(self, sample: SensorSample) -> AiPrediction:
        with self.lock:
            sample = sample.model_copy(deep=True)
            logger.info("Sensor sample received id=%s source=%s", sample.sample_id, sample.source)
            now = utc_now()
            problem = self._timestamp_problem(sample, now)
            if problem:
                reason = "Ignored sensor sample: " + problem
                logger.warning("%s id=%s source=%s", reason, sample.sample_id, sample.source)
                anomaly = AnomalyResult(status="insufficient_data", reason=reason,
                    missing_fields=[name for name in ("temperature", "humidity", "gas", "presence")
                                    if getattr(sample, name) is None], timestamp=sample.timestamp)
                vision = self._prediction_vision(sample, now)
                evidence = self._fuse(None, anomaly, vision, now)
                evidence.reasons.append(reason)
                evidence.degraded = True
                return self._build_prediction(sample, anomaly, vision, evidence, now)
            anomaly = self.detector.predict(sample)
            self._last_samples[sample.source] = sample
            if (sample.source == "simulation" and self.sample is not None
                    and self.sample.source == "live" and self._fresh(self.sample, now)):
                vision = self._prediction_vision(sample, now)
                return self._build_prediction(sample, anomaly, vision,
                                              self._fuse(sample, anomaly, vision, now), now)
            self.sample = sample
            self.anomaly = anomaly
            self._refresh(force=True)
            return self.latest.model_copy(deep=True)

    def _fresh(self, sample: SensorSample, now: datetime) -> bool:
        age = (now - sample.timestamp).total_seconds()
        return -FUTURE_TOLERANCE_SECONDS <= age <= self.settings.sensor_stale_seconds

    def _timestamp_problem(self, sample: SensorSample, now: datetime) -> str | None:
        age = (now - sample.timestamp).total_seconds()
        if age < -FUTURE_TOLERANCE_SECONDS:
            return "timestamp is too far in the future"
        if age > self.settings.sensor_stale_seconds:
            return "timestamp is stale"
        previous = self._last_samples.get(sample.source)
        if previous is None:
            return None
        if sample.timestamp < previous.timestamp:
            return "timestamp precedes the latest observation for this source"
        if sample.timestamp == previous.timestamp:
            if sample.sample_id is not None and previous.sample_id is not None:
                if sample.sample_id <= previous.sample_id:
                    return "duplicate or out-of-order sample ID at the same timestamp"
            elif all(getattr(sample, name) == getattr(previous, name)
                     for name in ("temperature", "humidity", "gas", "presence")):
                return "duplicate observation at the same timestamp"
        return None

    def _prediction_vision(self, sample: SensorSample | None, now: datetime) -> VisionResult:
        if sample is not None and sample.source == "simulation":
            return VisionResult(status="stopped", detection_status="stopped", timestamp=now,
                                error="Real camera evidence excluded from simulation")
        return self.vision

    def _fuse(self, sample: SensorSample | None, anomaly: AnomalyResult,
              vision: VisionResult, now: datetime) -> FusedEvidence:
        return fuse(sample, anomaly, vision, now,
                    self.settings.sensor_stale_seconds, self.settings.vision_stale_seconds)

    @staticmethod
    def _build_prediction(sample: SensorSample | None, anomaly: AnomalyResult,
                          vision: VisionResult, evidence: FusedEvidence, now: datetime) -> AiPrediction:
        return AiPrediction(
            sample_id=sample.sample_id if sample else None,
            sensor_timestamp=sample.timestamp if sample else None,
            anomaly=anomaly.model_copy(deep=True),
            # Face metadata stays in its own bounded in-memory history/status.
            vision=vision.model_copy(update={"faces": None}, deep=True),
            risk=evaluate(evidence, now), timestamp=now,
            source=sample.source if sample else "live",
        )

    def update_vision(self, vision: VisionResult) -> None:
        with self.lock:
            now = utc_now()
            timestamps = (vision.timestamp, vision.last_prediction_time, vision.last_frame_time)
            if any(value is not None and (value - now).total_seconds() > FUTURE_TOLERANCE_SECONDS
                   for value in timestamps):
                logger.warning("Ignored vision update with a future timestamp")
                return
            if vision.timestamp < self.vision.timestamp:
                return
            self.vision = vision.model_copy(deep=True)
            self._refresh(force=True)

    def _refresh(self, force: bool = False) -> None:
        now = utc_now()
        vision = self._prediction_vision(self.sample, now)
        evidence = self._fuse(self.sample, self.anomaly, vision, now)
        # Polling must expire stale evidence but not manufacture a new event each second.
        if not force and self.latest:
            old = self.latest.risk
            if (old.reasons == evidence.reasons and old.degraded == evidence.degraded
                    and old.confidence == round(evidence.confidence, 4)):
                return
        if not force and self.latest is None:
            return
        self.latest = self._build_prediction(self.sample, self.anomaly, vision, evidence, now)

    def status(self) -> dict:
        with self.lock:
            self._refresh()
            faces = self.camera.faces.snapshot()
            vision = self.vision.model_copy(update={"faces": faces, "timestamp": max(self.vision.timestamp, faces.timestamp)}, deep=True)
            return {"status": "online", "model_loaded": self.detector.loaded,
                    "vision": vision,
                    "latest_prediction": self.latest.model_copy(deep=True) if self.latest else None}

    def reload(self) -> bool:
        with self.lock:
            loaded = self.detector.reload()
            if self.sample:
                self.anomaly = self.detector.predict(self.sample)
                self._refresh(force=True)
            return loaded
