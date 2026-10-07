"""One local capture worker; optional inference never blocks the MJPEG feed."""
import importlib
import logging
import sys
import threading
import time
from collections.abc import Callable
from typing import TYPE_CHECKING, Any, Literal

from app.schemas.sensor import utc_now
from app.schemas.vision import DetectedObject, VisionResult
from app.vision.person_detector import PersonDetector, VisionUnavailable
from app.vision.tracker import PresenceConfirmation
from app.vision.face_recognition import FaceRecognitionService

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger("VISION")


class CameraService:
    def __init__(self, settings: "Settings", on_update: Callable[[VisionResult], None] | None = None):
        self.settings = settings
        self._on_update = on_update
        self._lock = threading.RLock()
        self._lifecycle_lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._inference_thread: threading.Thread | None = None
        self._face_thread: threading.Thread | None = None
        self.faces = FaceRecognitionService(settings)
        self._stop_event = threading.Event()
        self._frame_ready = threading.Event()
        self._face_ready = threading.Event()
        self._capture: Any = None
        self._frame: Any = None
        self._frame_number = 0
        self._result = VisionResult(status="stopped", detection_status="stopped")
        self._jpeg: bytes | None = None
        self._jpeg_version = 0
        self._last_notification = 0.0

    def start(self) -> VisionResult:
        """Idempotent and nonblocking; running means an actual JPEG is available."""
        with self._lifecycle_lock:
            # A cancelled detector may still be inside native model loading.
            # It owns no webcam and must not prevent raw video from restarting.
            workers = (self._thread,)
            if any(worker is not None and (worker.is_alive() or
                   (worker.ident is None and not self._stop_event.is_set())) for worker in workers):
                return self.snapshot()
            self._stop_event = threading.Event()
            self._frame_ready = threading.Event()
            self._face_ready = threading.Event()
            stop_event = self._stop_event
            face_session = self.faces.camera_started()
            with self._lock:
                self._result = VisionResult(status="starting", detection_status="loading")
                self._jpeg = None
                self._frame = None
                self._frame_number = 0
                self._last_notification = 0.0
                starting = self._result.model_copy(deep=True)
            thread = threading.Thread(target=self._run, args=(stop_event, face_session), name="sentinel-camera", daemon=True)
            self._thread = thread
        # A consumer may cancel starting; never call it while holding lifecycle locks.
        self._notify(starting, force=True, stop_event=stop_event)
        with self._lifecycle_lock:
            if self._thread is thread and not stop_event.is_set():
                thread.start()
        return self.snapshot()

    def stop(self) -> VisionResult:
        """Clear video immediately, signal both workers and release the owned device."""
        with self._lifecycle_lock:
            if self._result.status == "stopped" and not any(
                worker and worker.is_alive() for worker in (self._thread, self._inference_thread, self._face_thread)
            ):
                return self.snapshot()
            self._stop_event.set()
            self._frame_ready.set()
            self._face_ready.set()
            self.faces.camera_stopped()
            with self._lock:
                self._result = VisionResult(status="stopped", detection_status="stopped")
                self._jpeg = None
                self._frame = None
                capture = self._capture
            for worker in (self._thread, self._inference_thread, self._face_thread):
                if worker and worker.is_alive() and worker is not threading.current_thread():
                    worker.join(timeout=1.0)
            if capture is not None:
                self._release_owned(capture)
            capture_worker = self._thread
            detector_worker = self._inference_thread
            if capture_worker and not capture_worker.is_alive():
                self._thread = None
            if detector_worker and not detector_worker.is_alive():
                self._inference_thread = None
            face_worker = self._face_thread
            if face_worker and not face_worker.is_alive():
                self._face_thread = None
            result = self.snapshot()
        logger.info("Camera stopped")
        self._notify(result, force=True)
        return result

    def snapshot(self) -> VisionResult:
        with self._lock:
            result = self._result.model_copy(deep=True)
        faces = self.faces.snapshot()
        return result.model_copy(update={"faces": faces, "timestamp": max(result.timestamp, faces.timestamp)})

    def get_jpeg(self) -> bytes | None:
        with self._lock:
            return self._jpeg

    @property
    def jpeg_version(self) -> int:
        with self._lock:
            return self._jpeg_version

    def _run(self, stop_event: threading.Event, face_session: int) -> None:
        capture = None
        registered = False
        try:
            try:
                cv2 = importlib.import_module("cv2")
            except ImportError as error:
                raise VisionUnavailable("OpenCV est absent. Installez requirements-vision.txt.") from error
            capture, index, first_frame = self._open_camera(cv2, stop_event)
            with self._lock:
                if stop_event.is_set():
                    return
                self._capture = capture
                registered = True
            self._publish_frame(cv2, first_frame, index, 0, stop_event)
            if stop_event.is_set():
                return
            logger.info("Camera running index=%s", index)
            self._notify(self.snapshot(), force=True, stop_event=stop_event)
            inference = threading.Thread(target=self._infer, args=(stop_event,), name="sentinel-yolo", daemon=True)
            with self._lifecycle_lock:
                if stop_event.is_set():
                    return
                self._inference_thread = inference
                inference.start()
                if self.settings.face_enabled:
                    face_worker = threading.Thread(target=self._recognize_faces, args=(stop_event, face_session),
                        name="sentinel-face-recognition", daemon=True)
                    self._face_thread = face_worker
                    face_worker.start()
            self._capture_loop(cv2, capture, index, stop_event)
        except VisionUnavailable as error:
            self._failure("unavailable", str(error), stop_event)
        except Exception as error:
            logger.exception("Camera error")
            self._failure("error", f"Erreur webcam : {error}", stop_event)
        finally:
            stop_event.set()
            self._frame_ready.set()
            self._face_ready.set()
            if capture is not None:
                self._release_owned(capture) if registered else self._release(capture)
            with self._lock:
                if self._thread is threading.current_thread():
                    self._thread = None

    def _open_camera(self, cv2: Any, stop_event: threading.Event) -> tuple[Any, int, Any]:
        indexes = list(range(self.settings.camera_scan_limit))
        if self.settings.camera_index >= 0:
            indexes = [self.settings.camera_index] + [index for index in indexes if index != self.settings.camera_index]
        backends = [cv2.CAP_DSHOW, None] if sys.platform == "win32" else [None]
        opened_without_frame = False
        for index in indexes:
            for backend in backends:
                if stop_event.is_set():
                    raise VisionUnavailable("Démarrage de la webcam annulé.")
                capture = None
                logger.info("Starting camera index=%s backend=%s", index, "DSHOW" if backend is not None else "DEFAULT")
                try:
                    capture = cv2.VideoCapture(index, backend) if backend is not None else cv2.VideoCapture(index)
                    if capture.isOpened():
                        logger.info("Camera opened index=%s", index)
                        capture.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                        ok, frame = capture.read()
                        if ok and frame is not None:
                            logger.info("First frame received 640x480")
                            return capture, index, frame
                        opened_without_frame = True
                except PermissionError:
                    logger.warning("Camera access denied index=%s", index)
                except Exception as error:
                    logger.warning("Camera open failed index=%s: %s", index, error)
                if capture is not None:
                    self._release(capture)
        detail = "La webcam s'ouvre mais aucune image n'est lisible." if opened_without_frame else "Webcam introuvable, occupée ou accès Windows refusé."
        raise VisionUnavailable(detail + " Fermez Camera/Teams/Zoom et vérifiez l'index et les autorisations caméra des applications de bureau.")

    def _capture_loop(self, cv2: Any, capture: Any, index: int, stop_event: threading.Event) -> None:
        failures = 0
        count = 0
        started = time.perf_counter()
        period = 1.0 / self.settings.vision_max_fps
        while not stop_event.is_set():
            frame_started = time.perf_counter()
            ok, frame = capture.read()
            if stop_event.is_set():
                break
            if not ok or frame is None:
                failures += 1
                if failures >= 5:
                    raise VisionUnavailable("La webcam ne fournit plus d'images. Rebranchez-la, fermez les autres applications caméra et réessayez.")
                stop_event.wait(0.1)
                continue
            failures = 0
            count += 1
            fps = count / max(time.perf_counter() - started, period)
            self._publish_frame(cv2, frame, index, fps, stop_event)
            self._notify(self.snapshot(), stop_event=stop_event)
            stop_event.wait(max(0, period - (time.perf_counter() - frame_started)))

    def _publish_frame(self, cv2: Any, frame: Any, index: int, fps: float, stop_event: threading.Event) -> None:
        frame = cv2.resize(frame, (640, 480))
        with self._lock:
            vision = self._result.model_copy(deep=True)
        annotated = frame.copy()
        recent = vision.last_prediction_time and (utc_now() - vision.last_prediction_time).total_seconds() < 5
        if recent and vision.detection_status == "running":
            color = (50, 220, 70) if vision.confirmed else (0, 190, 255)
            for person in vision.objects:
                x1, y1, x2, y2 = [int(value) for value in person.bbox]
                x1, x2 = max(0, min(639, x1)), max(0, min(639, x2))
                y1, y2 = max(0, min(479, y1)), max(0, min(479, y2))
                label = f"person {person.confidence:.0%}" + (f" #{person.track_id}" if person.track_id is not None else "")
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                cv2.putText(annotated, label, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
        faces = self.faces.snapshot()
        if faces.status == "running" and faces.last_prediction_time and (utc_now() - faces.last_prediction_time).total_seconds() < 2:
            for face in faces.faces:
                x1, y1, x2, y2 = [int(value) for value in face.bbox]
                color = (50, 220, 70) if face.known else (30, 80, 255)
                label = f"{face.name} {face.confidence:.0%}" if face.known else "Unknown"
                cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                cv2.putText(annotated, label, (x1, max(18, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)
        ok, encoded = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
        if not ok:
            raise VisionUnavailable("Impossible d'encoder les images de la webcam en JPEG.")
        with self._lock:
            if stop_event.is_set() or stop_event is not self._stop_event:
                return
            self._jpeg = encoded.tobytes()
            self._jpeg_version += 1
            self._frame = frame
            self._frame_number += 1
            self._result = self._result.model_copy(update={
                "status": "running", "stream_ready": True, "camera_index": index,
                "timestamp": utc_now(), "last_frame_time": utc_now(), "fps": round(fps, 2),
            })
        self._frame_ready.set()
        self._face_ready.set()

    def _recognize_faces(self, stop_event: threading.Event, session: int) -> None:
        previous_number = -self.settings.face_every_n_frames
        ready = self._face_ready
        try:
            while not stop_event.is_set():
                if not ready.wait(timeout=0.2):
                    continue
                ready.clear()
                started = time.perf_counter()
                with self._lock:
                    if stop_event.is_set() or self._frame is None:
                        break
                    number = self._frame_number
                    if number - previous_number < self.settings.face_every_n_frames:
                        continue
                    frame = self._frame.copy()
                    vision = self._result.model_copy(deep=True)
                previous_number = number
                fresh_tracking = (vision.detection_status == "running" and vision.last_prediction_time
                    and (utc_now() - vision.last_prediction_time).total_seconds() < 1)
                self.faces.process(frame, vision.objects if fresh_tracking else [], session)
                if stop_event.is_set():
                    break
                self._notify(self.snapshot(), stop_event=stop_event)
                stop_event.wait(max(0, 1 / self.settings.face_max_fps - (time.perf_counter() - started)))
        finally:
            with self._lock:
                if self._face_thread is threading.current_thread():
                    self._face_thread = None

    def _infer(self, stop_event: threading.Event) -> None:
        acquired = False
        try:
            # Serialize detector instances across restarts without blocking capture.
            while not stop_event.is_set():
                if self._inference_lock.acquire(timeout=0.1):
                    acquired = True
                    break
            if not acquired or stop_event.is_set():
                return
            detector = PersonDetector(self.settings.yolo_model, self.settings.yolo_confidence, self.settings.vision_tracking)
            detector.load()
            confirmation = PresenceConfirmation(self.settings.vision_confirm_frames)
            previous_number = -self.settings.vision_frame_stride
            while not stop_event.is_set():
                if not self._frame_ready.wait(timeout=0.2):
                    continue
                self._frame_ready.clear()
                with self._lock:
                    if stop_event.is_set() or self._frame is None:
                        break
                    number = self._frame_number
                    if number - previous_number < self.settings.vision_frame_stride:
                        continue
                    frame = self._frame.copy()
                previous_number = number
                started = time.perf_counter()
                objects: list[DetectedObject] = detector.detect(frame)
                elapsed = (time.perf_counter() - started) * 1000
                confirmed = confirmation.update(objects)
                with self._lock:
                    if stop_event.is_set() or self._result.status != "running":
                        break
                    previous = self._result
                    self._result = previous.model_copy(update={
                        "person_detected": bool(objects), "person_count": len(objects),
                        "max_confidence": max((person.confidence for person in objects), default=0),
                        "objects": objects, "confirmed": confirmed, "timestamp": utc_now(),
                        "last_prediction_time": utc_now(), "inference_time_ms": round(elapsed, 2),
                        "detection_status": "running", "detection_error": None,
                    })
                    result = self._result.model_copy(deep=True)
                if result.person_detected != previous.person_detected or result.confirmed != previous.confirmed:
                    logger.info("Person detected count=%s confidence=%.2f confirmed=%s", len(objects), result.max_confidence, confirmed)
                self._notify(result, force=result.confirmed != previous.confirmed, stop_event=stop_event)
        except Exception as error:
            logger.warning("Person detection unavailable; keeping camera video: %s", error)
            with self._lock:
                if not stop_event.is_set() and self._result.status == "running":
                    self._result = self._result.model_copy(update={
                        "detection_status": "unavailable" if isinstance(error, VisionUnavailable) else "error",
                        "detection_error": str(error), "timestamp": utc_now(), "confirmed": False,
                        "person_detected": False, "person_count": 0, "objects": [], "max_confidence": 0,
                        "last_prediction_time": None,
                    })
            self._notify(self.snapshot(), force=True, stop_event=stop_event)
        finally:
            if acquired:
                self._inference_lock.release()
            with self._lock:
                if self._inference_thread is threading.current_thread():
                    self._inference_thread = None

    def _failure(self, status: Literal["unavailable", "error"], error: str, stop_event: threading.Event) -> None:
        if stop_event.is_set():
            return
        logger.warning("Camera error: %s", error)
        self.faces.camera_stopped()
        with self._lock:
            self._result = VisionResult(status=status, error=error, detection_status="stopped")
            self._jpeg = None
            self._frame = None
        self._notify(self.snapshot(), force=True, stop_event=stop_event)

    def _notify(self, result: VisionResult, force: bool = False, stop_event: threading.Event | None = None) -> None:
        if self._on_update is None or (stop_event is not None and (stop_event.is_set() or stop_event is not self._stop_event)):
            return
        with self._lock:
            if result.status != self._result.status:
                return
        now = time.perf_counter()
        if not force and now - self._last_notification < 0.5:
            return
        self._last_notification = now
        try:
            self._on_update(result.model_copy(deep=True))
        except Exception:
            logger.exception("Metadata consumer failed")

    def _release_owned(self, capture: Any) -> None:
        with self._lock:
            if self._capture is not capture:
                return
            self._capture = None
        self._release(capture)

    @staticmethod
    def _release(capture: Any) -> None:
        try:
            capture.release()
        except Exception:
            logger.debug("Camera release failed", exc_info=True)
