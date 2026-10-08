"""One feature extractor shared by CSV training and ordered online inference."""
from collections import deque

import numpy as np

from ..schemas.sensor import SensorSample

BASE_FEATURES = ("temperature", "humidity", "gas", "presence")
FEATURE_NAMES = BASE_FEATURES + (
    "temp_delta", "gas_delta", "temp_mean", "temp_std", "gas_mean", "gas_std",
    "temp_rate", "gas_rate", "temp_gas_product",
)


class FeatureExtractor:
    def __init__(self, medians: dict[str, float], window: int = 12):
        self.medians = medians
        self.history: deque[tuple[SensorSample, dict[str, float]]] = deque(maxlen=window)

    def reset(self) -> None:
        self.history.clear()

    def extract(self, sample: SensorSample) -> tuple[dict[str, float], list[str]]:
        missing = [name for name in BASE_FEATURES if getattr(sample, name) is None]
        values = {name: float(getattr(sample, name)) if name not in missing else self.medians[name]
                  for name in BASE_FEATURES}
        previous = self.history[-1] if self.history else None
        if previous:
            interval = (sample.timestamp - previous[0].timestamp).total_seconds()
            if sample.source == previous[0].source and interval < 0:
                raise ValueError("Sensor timestamp precedes the current feature window")
            # A source transition or a long outage is a new temporal sequence.
            if sample.source != previous[0].source or interval > 30:
                self.reset()
                previous = None
        temp_delta = values["temperature"] - previous[1]["temperature"] if previous else 0.0
        gas_delta = values["gas"] - previous[1]["gas"] if previous else 0.0
        # Missing values are imputed, but must not fabricate jumps or correlations.
        if "temperature" in missing or (previous and previous[0].temperature is None):
            temp_delta = 0.0
        if "gas" in missing or (previous and previous[0].gas is None):
            gas_delta = 0.0
        elapsed = (sample.timestamp - previous[0].timestamp).total_seconds() if previous else 1.0
        self.history.append((sample, values))
        temp = np.array([row[1]["temperature"] for row in self.history])
        gas = np.array([row[1]["gas"] for row in self.history])
        features = {
            **values, "temp_delta": temp_delta, "gas_delta": gas_delta,
            "temp_mean": float(temp.mean()), "temp_std": float(temp.std()),
            "gas_mean": float(gas.mean()), "gas_std": float(gas.std()),
            # Distinct samples can share a timestamp rounded to whole seconds.
            # Their elapsed time is unknown; do not invent a 0.1-second interval.
            "temp_rate": temp_delta / elapsed if elapsed > 0 else 0.0,
            "gas_rate": gas_delta / elapsed if elapsed > 0 else 0.0,
            "temp_gas_product": values["temperature"] * values["gas"],
        }
        return features, missing


def feature_vector(features: dict[str, float]) -> np.ndarray:
    return np.array([[features[name] for name in FEATURE_NAMES]], dtype=np.float64)
