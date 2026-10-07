"""Public face metadata; images and biometric vectors stay on the AI server."""
from datetime import datetime
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

from .sensor import utc_now


class FaceDetection(BaseModel):
    face_id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = "Unknown"
    known: bool = False
    confidence: float = Field(default=0, ge=0, le=1)
    similarity: float | None = Field(default=None, ge=-1, le=1)
    detection_confidence: float = Field(ge=0, le=1)
    recognizable: bool = True
    reason: str | None = None
    bbox: list[float] = Field(min_length=4, max_length=4)
    timestamp: datetime = Field(default_factory=utc_now)
    tracker_id: int | None = None


class FaceRecognitionResult(BaseModel):
    enabled: bool = True
    status: Literal["disabled", "loading", "running", "stopped", "unavailable", "error"] = "stopped"
    model_loaded: bool = False
    known_identities: int = 0
    reference_images: int = 0
    skipped_images: int = 0
    identities: list[str] = Field(default_factory=list)
    threshold: float = Field(default=0.55, gt=0, le=1)
    faces: list[FaceDetection] = Field(default_factory=list)
    history: list[FaceDetection] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=utc_now)
    last_prediction_time: datetime | None = None
    loaded_at: datetime | None = None
    inference_time_ms: float = 0
    error: str | None = None
    reload_error: str | None = None
    reloading: bool = False
    catalog_revision: int = 0
