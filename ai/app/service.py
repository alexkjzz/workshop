"""Coordinates ordered sensor inference and asynchronous server-camera updates."""
import logging
from threading import RLock

from .anomaly.detector import AnomalyDetector
from .config import Settings
from .fusion.risk_engine import evaluate
from .fusion.sensor_fusion import fuse
from .schemas.prediction import AiPrediction, AnomalyResult
from .schemas.sensor import SensorSample, utc_now
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
        self.camera = CameraService(settings, on_update=self.update_vision)

    def analyze(self, sample: SensorSample) -> AiPrediction:
        with self.lock:
            logger.info("Sensor sample received id=%s source=%s", sample.sample_id, sample.source)
            self.sample = sample
            self.anomaly = self.detector.predict(sample)
            self._refresh(force=True)
            return self.latest.model_copy(deep=True)

    def update_vision(self, vision: VisionResult) -> None:
        with self.lock:
            if vision.timestamp < self.vision.timestamp:
                return
            self.vision = vision.model_copy(deep=True)
            self._refresh(force=True)

    def _refresh(self, force: bool = False) -> None:
        now = utc_now()
        evidence = fuse(self.sample, self.anomaly, self.vision, now,
                        self.settings.sensor_stale_seconds, self.settings.vision_stale_seconds)
        # Polling must expire stale evidence but not manufacture a new event each second.
        if not force and self.latest:
            old = self.latest.risk
            if (old.reasons == evidence.reasons and old.degraded == evidence.degraded
                    and old.confidence == round(evidence.confidence, 4)):
                return
        if not force and self.latest is None:
            return
        self.latest = AiPrediction(
            sample_id=self.sample.sample_id if self.sample else None,
            sensor_timestamp=self.sample.timestamp if self.sample else None,
            # Face events have their own bounded in-memory history/status. Do not
            # duplicate biometric metadata in every persisted sensor/risk result.
            anomaly=self.anomaly.model_copy(deep=True), vision=self.vision.model_copy(update={"faces": None}, deep=True),
            risk=evaluate(evidence, now), timestamp=now,
            source=self.sample.source if self.sample else "live",
        )

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
