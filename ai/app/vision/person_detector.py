"""Load a local YOLO model and return person-only detection metadata."""

import importlib
import logging
import os
from pathlib import Path
from typing import Any

from app.schemas.vision import DetectedObject

logger = logging.getLogger(__name__)


class VisionUnavailable(RuntimeError):
    """A camera/model dependency is absent; the rest of Sentinel-X can continue."""


class PersonDetector:
    def __init__(self, model_path: Path, confidence: float = 0.55, tracking: bool = True) -> None:
        self.model_path = Path(model_path)
        self.confidence = confidence
        self.tracking = tracking
        self._model: Any = None

    def load(self) -> None:
        # Requiring an existing file prevents Ultralytics' implicit model download.
        if not self.model_path.is_file():
            raise VisionUnavailable(
                f"YOLO weights missing: {self.model_path}. Download the model explicitly before starting vision."
            )
        # Optional tracker dependencies must never install themselves at runtime.
        os.environ["YOLO_AUTOINSTALL"] = "False"
        if not os.environ.get("YOLO_CONFIG_DIR"):
            os.environ["YOLO_CONFIG_DIR"] = str(Path(__file__).resolve().parents[2] / ".runtime" / "ultralytics")
        try:
            Path(os.environ["YOLO_CONFIG_DIR"]).expanduser().mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise VisionUnavailable("YOLO configuration directory is not writable.") from exc
        try:
            ultralytics = importlib.import_module("ultralytics")
        except ImportError as exc:
            raise VisionUnavailable("Install requirements-vision.txt to enable YOLO detection.") from exc
        self._model = ultralytics.YOLO(str(self.model_path.resolve()))
        logger.info("[VISION] Local YOLO model loaded: %s", self.model_path)

    def detect(self, frame: Any) -> list[DetectedObject]:
        if self._model is None:
            raise VisionUnavailable("YOLO model is not loaded.")

        options = {"source": frame, "classes": [0], "conf": self.confidence, "verbose": False}
        if self.tracking:
            try:
                results = self._model.track(**options, persist=True, tracker="bytetrack.yaml")
            except Exception as exc:
                # Tracking is optional: do not lose person detection because lap is absent.
                logger.warning("[VISION] ByteTrack unavailable; continuing with detection: %s", exc)
                self.tracking = False
                # A failed tracker can leave predictor callbacks registered. Reset the
                # owned model before predicting so those callbacks cannot fail again.
                reset_callbacks = getattr(self._model, "reset_callbacks", None)
                if callable(reset_callbacks):
                    reset_callbacks()
                if hasattr(self._model, "predictor"):
                    self._model.predictor = None
                results = self._model.predict(**options, mode="predict")
        else:
            results = self._model.predict(**options, mode="predict")

        people: list[DetectedObject] = []
        for result in results:
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                continue
            coordinates = self._values(boxes.xyxy)
            confidences = self._values(boxes.conf)
            classes = self._values(boxes.cls)
            track_ids = self._values(boxes.id) if getattr(boxes, "id", None) is not None else []
            for index, (bbox, confidence, class_id) in enumerate(zip(coordinates, confidences, classes)):
                # Also filter the output defensively if a custom model ignores classes=[0].
                if int(class_id) != 0 or float(confidence) < self.confidence:
                    continue
                people.append(
                    DetectedObject(
                        **{
                            "class": "person",
                            "confidence": float(confidence),
                            "bbox": [float(value) for value in bbox],
                            "track_id": int(track_ids[index]) if index < len(track_ids) else None,
                        }
                    )
                )
        return people

    @staticmethod
    def _values(value: Any) -> list[Any]:
        if hasattr(value, "cpu"):
            value = value.cpu()
        return value.tolist() if hasattr(value, "tolist") else list(value)
