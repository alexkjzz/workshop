"""Configuration resolved relative to ai/, independent of the caller's directory."""
import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

AI_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(AI_ROOT / ".env", override=False)


def env_path(name: str, default: str) -> Path:
    value = Path(os.getenv(name, default))
    return value if value.is_absolute() else AI_ROOT / value


@dataclass(frozen=True)
class Settings:
    host: str = field(default_factory=lambda: os.getenv("AI_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.getenv("AI_PORT", "8001")))
    service_token: str = field(default_factory=lambda: os.getenv("AI_SERVICE_TOKEN", ""))
    backend_url: str = field(default_factory=lambda: os.getenv("BACKEND_URL", "http://127.0.0.1:3001"))
    model_path: Path = field(default_factory=lambda: env_path("ANOMALY_MODEL", "models/isolation_forest.joblib"))
    sensor_csv: Path = field(default_factory=lambda: env_path("SENSOR_CSV", "data/sensor_data.csv"))
    anomaly_window: int = field(default_factory=lambda: int(os.getenv("ANOMALY_WINDOW", "12")))
    contamination: float = field(default_factory=lambda: float(os.getenv("ANOMALY_CONTAMINATION", "0.03")))
    sensor_stale_seconds: float = field(default_factory=lambda: float(os.getenv("SENSOR_STALE_SECONDS", "30")))
    vision_stale_seconds: float = field(default_factory=lambda: float(os.getenv("VISION_STALE_SECONDS", "5")))
    camera_index: int = field(default_factory=lambda: int(os.getenv("VISION_CAMERA_INDEX", os.getenv("CAMERA_INDEX", "0"))))
    camera_scan_limit: int = field(default_factory=lambda: int(os.getenv("CAMERA_SCAN_LIMIT", "4")))
    yolo_model: Path = field(default_factory=lambda: env_path("YOLO_MODEL", "models/yolov8n.pt"))
    yolo_confidence: float = field(default_factory=lambda: float(os.getenv("YOLO_CONFIDENCE", "0.55")))
    vision_confirm_frames: int = field(default_factory=lambda: int(os.getenv("VISION_CONFIRM_FRAMES", "3")))
    vision_frame_stride: int = field(default_factory=lambda: int(os.getenv("VISION_FRAME_STRIDE", "3")))
    vision_max_fps: float = field(default_factory=lambda: float(os.getenv("VISION_MAX_FPS", "15")))
    vision_tracking: bool = field(default_factory=lambda: os.getenv("VISION_TRACKING", "true").lower() == "true")
    vision_auto_start: bool = field(default_factory=lambda: os.getenv("VISION_AUTO_START", "false").lower() == "true")
    face_enabled: bool = field(default_factory=lambda: os.getenv("FACE_RECOGNITION_ENABLED", "true").lower() == "true")
    face_threshold: float = field(default_factory=lambda: float(os.getenv("FACE_RECOGNITION_THRESHOLD", "0.55")))
    face_every_n_frames: int = field(default_factory=lambda: int(os.getenv("FACE_RECOGNITION_EVERY_N_FRAMES", "3")))
    face_max_fps: float = field(default_factory=lambda: float(os.getenv("FACE_RECOGNITION_MAX_FPS", "2")))
    face_known_dir: Path = field(default_factory=lambda: env_path("FACE_KNOWN_DIR", "known_faces"))
    face_detector_model: Path = field(default_factory=lambda: env_path("FACE_DETECTOR_MODEL", "models/face_detection_yunet_2023mar.onnx"))
    face_embedding_model: Path = field(default_factory=lambda: env_path("FACE_EMBEDDING_MODEL", "models/face_recognition_sface_2021dec.onnx"))
    face_event_cooldown: float = field(default_factory=lambda: float(os.getenv("FACE_EVENT_COOLDOWN_SECONDS", "5")))
    face_min_size: int = field(default_factory=lambda: int(os.getenv("FACE_MIN_SIZE_PIXELS", "40")))

    def __post_init__(self):
        if not 1 <= self.port <= 65535:
            raise ValueError("AI_PORT must be between 1 and 65535")
        if self.anomaly_window < 2 or not 0 < self.contamination <= 0.5:
            raise ValueError("Invalid anomaly window or contamination")
        if min(self.vision_confirm_frames, self.vision_frame_stride, self.camera_scan_limit) < 1:
            raise ValueError("Vision counts must be positive")
        if not 0 < self.yolo_confidence <= 1 or self.vision_max_fps <= 0:
            raise ValueError("Invalid vision confidence or FPS")
        if min(self.sensor_stale_seconds, self.vision_stale_seconds) <= 0:
            raise ValueError("Freshness timeouts must be positive")
        if not 0 < self.face_threshold <= 1 or not 0 < self.face_max_fps <= 15:
            raise ValueError("Invalid face recognition threshold or FPS")
        if self.face_every_n_frames < 1 or self.face_min_size < 10 or self.face_event_cooldown < 0:
            raise ValueError("Invalid face recognition cadence, minimum size or cooldown")
