from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from .sensor import utc_now
from .vision import VisionResult


class AnomalyResult(BaseModel):
    status: Literal["ready", "untrained", "insufficient_data", "error"]
    is_anomaly: bool | None = None
    anomaly_score: float | None = Field(default=None, ge=0, le=1)
    confidence: float | None = Field(default=None, ge=0, le=1)
    reason: str
    features: dict[str, float] = Field(default_factory=dict)
    missing_fields: list[str] = Field(default_factory=list)
    timestamp: datetime = Field(default_factory=utc_now)


class RiskResult(BaseModel):
    risk_score: int = Field(ge=0, le=100)
    risk_level: Literal["SAFE", "LOW", "MEDIUM", "HIGH", "CRITICAL"]
    category: Literal["SAFE", "INTRUSION", "ENVIRONMENT", "MULTI_THREAT", "SENSOR_ANOMALY"]
    reasons: list[str]
    confidence: float = Field(ge=0, le=1)
    degraded: bool
    timestamp: datetime = Field(default_factory=utc_now)


class AiPrediction(BaseModel):
    sample_id: int | None = None
    sensor_timestamp: datetime | None = None
    anomaly: AnomalyResult
    vision: VisionResult
    risk: RiskResult
    timestamp: datetime = Field(default_factory=utc_now)
    source: Literal["live", "simulation"] = "live"
