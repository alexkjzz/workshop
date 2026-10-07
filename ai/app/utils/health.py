from ..schemas.sensor import utc_now


def health_status(model_loaded: bool) -> dict:
    return {"status": "ok", "service": "sentinel-x-ai", "model_loaded": model_loaded, "timestamp": utc_now()}
