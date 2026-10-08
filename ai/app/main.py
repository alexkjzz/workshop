"""Local FastAPI transport; the browser communicates exclusively with Express."""
import asyncio
import hmac
import json
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from .config import Settings
from .schemas.sensor import SensorSample
from .schemas.face import FaceEnrollmentRequest, MAX_FACE_BODY_BYTES
from .vision.face_enrollment import EnrollmentError
from .vision.face_recognition import FaceUnavailable
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

    @api.post("/vision/faces/enroll", dependencies=[Depends(authorized)])
    async def face_enroll(request: Request):
        if request.headers.get("content-type", "").split(";")[0].strip().lower() != "application/json":
            raise HTTPException(status_code=415, detail="Envoyez les photos au format JSON.")
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > MAX_FACE_BODY_BYTES:
                raise HTTPException(status_code=413, detail="Envoi trop volumineux : maximum 15 Mio de photos.")
            body.extend(chunk)
        try:
            payload = FaceEnrollmentRequest.model_validate(json.loads(body.decode("utf-8")))
        except (ValueError, UnicodeError) as error:
            # Validation errors must not echo the base64 image or request body.
            detail = "Nom et une à cinq photos JPEG, PNG ou WebP sont requis."
            if isinstance(error, ValidationError):
                detail = "; ".join(str(item["msg"]) for item in error.errors(include_input=False, include_url=False))
            raise HTTPException(status_code=422, detail=detail) from None
        try:
            return await asyncio.to_thread(engine.camera.faces.enroll, payload)
        except EnrollmentError as error:
            raise HTTPException(status_code=error.status_code, detail=str(error)) from None
        except FaceUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from None
        except OSError:
            raise HTTPException(status_code=503, detail="Impossible d'enregistrer les photos dans le catalogue local.") from None

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
        tls = ({"ssl_certfile": str(settings.tls_cert_file), "ssl_keyfile": str(settings.tls_key_file)}
               if settings.tls_cert_file else {})
        config = uvicorn.Config(lambda: create_app(settings), factory=True, host=settings.host, port=settings.port,
                                **tls)
        try:
            uvicorn.Server(config).run(sockets=[listener])
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
