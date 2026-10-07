from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SensorSample(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="ignore")
    temperature: float | None = None
    humidity: float | None = None
    gas: float | None = None
    presence: bool | None = None
    timestamp: datetime = Field(default_factory=utc_now)
    sample_id: int | None = None
    source: Literal["live", "simulation"] = "live"

    @field_validator("timestamp")
    @classmethod
    def aware_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

    @field_validator("presence", mode="before")
    @classmethod
    def binary_presence(cls, value):
        if value is None or isinstance(value, bool) or (type(value) in (int, float) and value in (0, 1)):
            return value
        raise ValueError("presence must be a boolean or 0/1")
