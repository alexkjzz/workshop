"""Optional, local webcam analysis. Heavy dependencies load only on start."""

from app.vision.camera import CameraService

__all__ = ["CameraService"]
