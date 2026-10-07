"""Local FastAPI transport; the browser communicates exclusively with Express."""
import asyncio
import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse

from .config import Settings
from .schemas.sensor import SensorSample
from .service import AiEngine
from .utils.health import health_status
from .utils.logger import configure_logging
from .utils.startup import local_service_url, reserve_listener


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = AiEngine(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        engine.camera.faces.startup()
        if settings.vision_auto_start:
            engine.camera.start()
        yield
        await asyncio.to_thread(engine.camera.stop)
        await asyncio.to_thread(engine.camera.faces.shutdown)

    def authorized(request: Request):
        if settings.service_token and not hmac.compare_digest(
            request.headers.get("authorization", ""), "Bearer " + settings.service_token
        ):
            raise HTTPException(status_code=401, detail="Invalid AI service token")

    api = FastAPI(title="Sentinel-X AI", version="1.0.0", lifespan=lifespan)
    api.state.engine = engine

    @api.get("/")
    def root():
        return {"service": "sentinel-x-ai", "docs": "/docs", "sensor_ingestion": "/analyze"}

    @api.get("/health")
    def health():
        return health_status(engine.detector.loaded)

    @api.get("/status", dependencies=[Depends(authorized)])
    def status():
        return engine.status()

    @api.post("/analyze", dependencies=[Depends(authorized)])
    def analyze(sample: SensorSample):
        return engine.analyze(sample).model_dump(mode="json", by_alias=True)

    @api.post("/predict/anomaly", dependencies=[Depends(authorized)])
    def anomaly(sample: SensorSample):
        return engine.analyze(sample).anomaly

    @api.post("/model/reload", dependencies=[Depends(authorized)])
    def reload_model():
        return {"model_loaded": engine.reload()}

    @api.get("/vision/status", dependencies=[Depends(authorized)])
    def vision_status():
        return engine.camera.snapshot().model_dump(mode="json", by_alias=True)

    @api.post("/vision/start", dependencies=[Depends(authorized)])
    def vision_start():
        return engine.camera.start().model_dump(mode="json", by_alias=True)

    @api.post("/vision/stop", dependencies=[Depends(authorized)])
    def vision_stop():
        return engine.camera.stop().model_dump(mode="json", by_alias=True)

    @api.get("/vision/faces/status", dependencies=[Depends(authorized)])
    def face_status():
        return engine.camera.faces.snapshot()

    @api.get("/vision/faces/latest", dependencies=[Depends(authorized)])
    def face_latest():
        result = engine.camera.faces.snapshot()
        return {"faces": result.faces, "timestamp": result.last_prediction_time, "status": result.status}

    @api.get("/vision/faces/history", dependencies=[Depends(authorized)])
    def face_history():
        return {"faces": engine.camera.faces.snapshot().history}

    @api.post("/vision/faces/reload", dependencies=[Depends(authorized)])
    def face_reload():
        return engine.camera.faces.reload()

    @api.get("/risk/latest", dependencies=[Depends(authorized)])
    def latest_risk():
        prediction = engine.status()["latest_prediction"]
        return prediction.risk if prediction else None

    @api.get("/stream.mjpg", dependencies=[Depends(authorized)])
    async def stream(request: Request):
        if engine.camera.snapshot().status != "running":
            vision = engine.camera.snapshot()
            raise HTTPException(status_code=503, detail=vision.error or (
                "La webcam démarre. Attendez son état running." if vision.status == "starting"
                else "La webcam est arrêtée. Démarrez-la avec /vision/start."
            ))
        if engine.camera.get_jpeg() is None:
            raise HTTPException(status_code=503, detail="La première image de la webcam n'est pas encore disponible.")

        async def frames():
            last_jpeg = None
            while not await request.is_disconnected():
                if engine.camera.snapshot().status != "running":
                    break
                jpeg = engine.camera.get_jpeg()
                if jpeg is not None and jpeg is not last_jpeg:
                    last_jpeg = jpeg
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                           + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                await asyncio.sleep(1 / settings.vision_max_fps)

        return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    return api


def main() -> None:
    import uvicorn
    configure_logging()
    settings = Settings()
    listener = reserve_listener(settings)
    if listener is None:
        return
    with listener:
        logging.getLogger("STARTUP").info("Démarrage de Sentinel-X IA sur %s", local_service_url(settings))
        config = uvicorn.Config(lambda: create_app(settings), factory=True, host=settings.host, port=settings.port)
        try:
            uvicorn.Server(config).run(sockets=[listener])
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
