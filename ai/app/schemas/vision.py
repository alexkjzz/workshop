from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .sensor import utc_now
from .face import FaceRecognitionResult


class DetectedObject(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    class_name: str = Field(default="person", alias="class")
    confidence: float = Field(ge=0, le=1)
    bbox: list[float] = Field(min_length=4, max_length=4)
    track_id: int | None = None


class VisionResult(BaseModel):
    status: Literal["stopped", "starting", "running", "unavailable", "error"] = "stopped"
    error: str | None = None
    person_detected: bool = False
    person_count: int = Field(default=0, ge=0)
    max_confidence: float = Field(default=0, ge=0, le=1)
    confirmed: bool = False
    objects: list[DetectedObject] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=utc_now)
    fps: float = 0
    inference_time_ms: float = 0
    last_prediction_time: datetime | None = None
    stream_ready: bool = False
    camera_index: int | None = None
    last_frame_time: datetime | None = None
    detection_status: Literal["loading", "running", "unavailable", "error", "stopped"] | None = None
    detection_error: str | None = None
    faces: FaceRecognitionResult | None = None
