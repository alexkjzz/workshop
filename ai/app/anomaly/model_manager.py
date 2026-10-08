"""Versioned local artifacts. Only load trusted, locally trained joblib files."""
import logging
from pathlib import Path

import joblib
import sklearn

from .preprocessing import FEATURE_NAMES

logger = logging.getLogger("AI")
ARTIFACT_VERSION = 1


def load_model(path: Path) -> tuple[dict | None, str | None]:
    if not path.is_file():
        return None, "Isolation Forest not trained; run app.anomaly.trainer"
    try:
        artifact = joblib.load(path)
        if artifact.get("version") != ARTIFACT_VERSION or artifact.get("feature_names") != list(FEATURE_NAMES):
            raise ValueError("incompatible feature schema; retrain model")
        if artifact.get("sklearn_version") != sklearn.__version__:
            raise ValueError("scikit-learn version changed; retrain model")
        for key in ("model", "medians", "window", "decision_scale", "baseline_mean", "baseline_std"):
            if key not in artifact:
                raise ValueError(f"incomplete artifact: {key}")
        logger.info("Isolation Forest loaded (%s)", path)
        return artifact, None
    except Exception as error:
        logger.warning("Could not load Isolation Forest: %s", error)
        return None, str(error)


def save_model(artifact: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    joblib.dump(artifact, temporary)
    temporary.replace(path)
