"""Train on a chronological CSV of known normal observations, never on live startup."""
import argparse
import csv
import logging
from pathlib import Path

import numpy as np
import sklearn
from sklearn.ensemble import IsolationForest

from ..config import Settings
from ..schemas.sensor import SensorSample
from ..utils.logger import configure_logging
from .model_manager import ARTIFACT_VERSION, save_model
from .preprocessing import BASE_FEATURES, FEATURE_NAMES, FeatureExtractor, feature_vector


def read_samples(path: Path) -> list[SensorSample]:
    samples = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not set(BASE_FEATURES).issubset(reader.fieldnames or []):
            raise ValueError("CSV needs temperature,humidity,gas,presence columns")
        for index, row in enumerate(reader, start=2):
            try:
                data = {key: float(row[key]) if row.get(key, "").strip() else None for key in BASE_FEATURES}
                if row.get("timestamp"):
                    data["timestamp"] = row["timestamp"]
                elif row.get("ts"):
                    data["timestamp"] = float(row["ts"])
                else:
                    # Without timestamps assume the firmware's 2-second cadence.
                    data["timestamp"] = index * 2
                sample = SensorSample.model_validate(data)
                if sample.quality_issues:
                    raise ValueError("; ".join(sample.quality_issues))
                samples.append(sample)
            except Exception as error:
                raise ValueError(f"Invalid CSV row {index}: {error}") from error
    return sorted(samples, key=lambda sample: sample.timestamp)


def train(samples: list[SensorSample], output: Path, window: int = 12,
          contamination: float = 0.03, seed: int = 42) -> dict:
    if len(samples) < 128:
        raise ValueError("At least 128 normal samples required; use real CSV or explicit simulator --generate-training")
    if any(sample.quality_issues for sample in samples):
        raise ValueError("Training data contains sensor values outside physical ranges")
    medians = {}
    for name in BASE_FEATURES:
        observed = [float(getattr(sample, name)) for sample in samples if getattr(sample, name) is not None]
        if len(observed) < 128:
            raise ValueError(f"At least 128 observed values needed for {name}")
        medians[name] = float(np.median(observed))
    extractor = FeatureExtractor(medians, window)
    matrix = np.vstack([feature_vector(extractor.extract(sample)[0]) for sample in samples])
    model = IsolationForest(n_estimators=200, contamination=contamination, random_state=seed, n_jobs=1)
    model.fit(matrix)
    decisions = model.decision_function(matrix)
    artifact = {
        "version": ARTIFACT_VERSION, "sklearn_version": sklearn.__version__,
        "feature_names": list(FEATURE_NAMES), "window": window, "medians": medians,
        "model": model, "decision_scale": max(float(np.std(decisions)), 0.01),
        "baseline_mean": dict(zip(FEATURE_NAMES, matrix.mean(axis=0).tolist())),
        "baseline_std": dict(zip(FEATURE_NAMES, np.maximum(matrix.std(axis=0), 1e-6).tolist())),
        "training_samples": len(samples), "contamination": contamination,
    }
    save_model(artifact, output)
    logging.getLogger("AI").info("Isolation Forest trained on %d samples -> %s", len(samples), output)
    return artifact


def main() -> None:
    configure_logging()
    settings = Settings()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=settings.sensor_csv)
    parser.add_argument("--output", type=Path, default=settings.model_path)
    args = parser.parse_args()
    try:
        train(read_samples(args.csv), args.output, settings.anomaly_window, settings.contamination)
    except (ValueError, OSError) as error:
        parser.exit(1, f"[AI] Training failed: {error}\n")


if __name__ == "__main__":
    main()
