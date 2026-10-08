"""Local YuNet/SFace embeddings, atomic reference reload and bounded face events."""
import importlib
import logging
import threading
import time
from tempfile import TemporaryDirectory
from uuid import uuid4
from collections import deque
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np

from app.schemas.face import FaceDetection, FaceEnrollmentRequest, FaceEnrollmentResult, FaceRecognitionResult, RejectedFaceImage
from app.schemas.sensor import utc_now
from app.schemas.vision import DetectedObject
from .face_enrollment import EnrollmentError, identity_directory, is_link, normalized_photo, uploaded_images

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger("FACE")
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


class FaceUnavailable(RuntimeError):
    pass


def normalized_embedding(value: Any) -> np.ndarray:
    embedding = np.asarray(value, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(embedding))
    if not embedding.size or not np.isfinite(embedding).all() or norm < 1e-8:
        raise ValueError("Invalid face embedding")
    return embedding / norm


def match_embedding(embedding: Any, references: dict[str, list[np.ndarray]], threshold: float) -> tuple[str, float | None]:
    query = normalized_embedding(embedding)
    best_name, best_score = "Unknown", float('-inf')
    for name, vectors in references.items():
        for vector in vectors:
            if query.shape != vector.shape:
                continue
            score = float(np.clip(np.dot(query, vector), -1, 1))
            if score > best_score:
                best_name, best_score = name, score
    if best_name == "Unknown":
        return "Unknown", None
    return (best_name if best_score >= threshold else "Unknown"), best_score


def associate_tracker(bbox: list[float], people: list[DetectedObject]) -> int | None:
    x1, y1, x2, y2 = bbox
    containing = [person for person in people if person.track_id is not None
                  and person.bbox[0] <= x1 and person.bbox[1] <= y1
                  and person.bbox[2] >= x2 and person.bbox[3] >= y2]
    if not containing:
        return None
    return min(containing, key=lambda p: (p.bbox[2] - p.bbox[0]) * (p.bbox[3] - p.bbox[1])).track_id


def overlap(a: list[float], b: list[float]) -> float:
    width = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    height = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    area = width * height
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - area
    return area / union if union > 0 else 0


class OpenCvFaceEmbedder:
    def __init__(self, settings: "Settings"):
        self.settings = settings
        self.cv2: Any = None
        self.detector: Any = None
        self.recognizer: Any = None

    def load(self) -> None:
        for path in (self.settings.face_detector_model, self.settings.face_embedding_model):
            if not path.is_file():
                raise FaceUnavailable(f"Modèle facial absent : {path.name}. Exécutez python -m app.vision.setup_faces.")
        try:
            self.cv2 = importlib.import_module("cv2")
            self.detector = self.cv2.FaceDetectorYN.create(str(self.settings.face_detector_model), "", (640, 480), 0.9, 0.3, 5000)
            self.recognizer = self.cv2.FaceRecognizerSF.create(str(self.settings.face_embedding_model), "")
        except (ImportError, AttributeError) as error:
            raise FaceUnavailable("Installez requirements-vision.txt pour activer YuNet/SFace.") from error

    def read_image(self, path: Path) -> Any:
        # imdecode/fromfile supports Windows paths containing accented names.
        return self.cv2.imdecode(np.fromfile(path, dtype=np.uint8), self.cv2.IMREAD_COLOR)

    def detect(self, frame: Any) -> list[Any]:
        self.detector.setInputSize((frame.shape[1], frame.shape[0]))
        _, faces = self.detector.detect(frame)
        return [] if faces is None else list(faces[:20])

    def embedding(self, frame: Any, face: Any) -> np.ndarray:
        return normalized_embedding(self.recognizer.feature(self.recognizer.alignCrop(frame, face)))


class FaceRecognitionService:
    def __init__(self, settings: "Settings", backend: Any = None):
        self.settings = settings
        self._backend = backend or OpenCvFaceEmbedder(settings)
        self._lock = threading.RLock()
        self._model_lock = threading.RLock()
        self._startup_thread: threading.Thread | None = None
        self._shutdown = threading.Event()
        self._active = False
        self._session = 0
        self._references: dict[str, list[np.ndarray]] = {}
        self._reference_files: set[Path] = set()
        self._history: deque[FaceDetection] = deque(maxlen=20)
        self._last_events: dict[str, float] = {}
        self._recent_faces: list[FaceDetection] = []
        self._state = FaceRecognitionResult(enabled=settings.face_enabled,
            status="loading" if settings.face_enabled else "disabled", threshold=settings.face_threshold)

    def startup(self) -> None:
        with self._lock:
            if not self.settings.face_enabled or self._state.model_loaded or self._startup_thread is not None or self._shutdown.is_set():
                return
            self._startup_thread = threading.Thread(target=self.reload, name="sentinel-face-catalog", daemon=True)
            self._startup_thread.start()

    def camera_started(self) -> int:
        with self._lock:
            self._active = True
            self._session += 1
            self._last_events.clear()
            self._recent_faces.clear()
            status = "disabled" if not self.settings.face_enabled else "unavailable" if self._state.error else "loading"
            self._state = self._state.model_copy(update={"status": status, "faces": [], "last_prediction_time": None, "timestamp": utc_now()})
            session = self._session
        self.startup()
        return session

    def camera_stopped(self) -> None:
        with self._lock:
            self._active = False
            self._session += 1
            self._recent_faces.clear()
            self._state = self._state.model_copy(update={"status": "stopped" if self.settings.face_enabled else "disabled",
                "faces": [], "last_prediction_time": None, "timestamp": utc_now()})

    def shutdown(self) -> None:
        self._shutdown.set()
        self.camera_stopped()
        worker = self._startup_thread
        if worker and worker.is_alive() and worker is not threading.current_thread():
            worker.join(timeout=1)

    def snapshot(self) -> FaceRecognitionResult:
        with self._lock:
            return self._state.model_copy(update={"history": list(self._history)}, deep=True)

    def enroll(self, request: FaceEnrollmentRequest) -> FaceEnrollmentResult:
        """Append validated references and reload under the facial-model lock only."""
        name, uploads = uploaded_images(request)
        if not self.settings.face_enabled or self._shutdown.is_set():
            raise FaceUnavailable("La reconnaissance faciale est désactivée ou en cours d'arrêt.")
        prepared, rejected = [], []
        try:
            for filename, content in uploads:
                try:
                    prepared.append((filename, normalized_photo(content)))
                except ValueError as error:
                    rejected.append(RejectedFaceImage(filename=filename, message=str(error)))
        except ImportError as error:
            raise FaceUnavailable("Installez requirements-vision.txt pour ajouter des photos.") from error

        with self._model_lock:
            if not self._state.model_loaded:
                catalog = self.reload()
                if not catalog.model_loaded:
                    raise FaceUnavailable(catalog.error or "Le modèle facial est indisponible.")
            if self._shutdown.is_set():
                raise FaceUnavailable("Le service facial est en cours d'arrêt.")
            root = self.settings.face_known_dir
            destination = identity_directory(root, name)
            name = destination.name
            # Hidden staging folders are skipped by all catalogue scans.
            with TemporaryDirectory(prefix=".enroll-", dir=root) as temporary:
                staged = []
                for filename, content in prepared:
                    path = Path(temporary) / (uuid4().hex + ".jpg")
                    with path.open("xb") as handle:
                        handle.write(content)
                    try:
                        image = self._backend.read_image(path)
                        if image is None:
                            raise ValueError("Photo illisible ou endommagée.")
                        faces = self._backend.detect(image)
                        if not faces:
                            raise ValueError("Aucun visage détecté. Choisissez une photo nette et rapprochée.")
                        if len(faces) != 1:
                            raise ValueError("Plusieurs visages détectés. Choisissez une photo avec une seule personne.")
                        face = faces[0]
                        if min(float(face[2]), float(face[3])) < self.settings.face_min_size:
                            raise ValueError("Visage trop petit. Choisissez une photo plus rapprochée.")
                        try:
                            normalized_embedding(self._backend.embedding(image, face))
                        except ValueError as error:
                            raise ValueError("Visage non identifiable. Choisissez une photo nette et de face.") from error
                    except Exception as error:
                        message = str(error) if isinstance(error, ValueError) else "Impossible d'analyser le visage de cette photo."
                        rejected.append(RejectedFaceImage(filename=filename, message=message))
                        continue
                    staged.append(path)

                if not staged:
                    return FaceEnrollmentResult(name=name, added=0, rejected=rejected, catalog=self.snapshot())
                created = not destination.exists()
                destination.mkdir(exist_ok=True)
                committed = []
                try:
                    # Recheck after directory creation; never follow identity links/junctions.
                    if is_link(destination) or destination.resolve().parent != root.resolve():
                        raise EnrollmentError("Dossier de référence invalide.")
                    for path in staged:
                        target = destination / path.name
                        with target.open("xb") as handle:
                            committed.append(target)
                            handle.write(path.read_bytes())
                    catalog = self.reload()
                    if catalog.reload_error or not set(committed).issubset(self._reference_files):
                        raise FaceUnavailable("Les photos n'ont pas pu être chargées dans le catalogue facial.")
                except Exception:
                    # Roll back only files created by this request, never prior references.
                    for target in committed:
                        target.unlink(missing_ok=True)
                    if created:
                        destination.rmdir()
                    self.reload()
                    raise
                logger.info("Added %s reference images for %s", len(committed), name)
                return FaceEnrollmentResult(name=name, added=len(committed), rejected=rejected, catalog=catalog)

    def reload(self) -> FaceRecognitionResult:
        if not self.settings.face_enabled:
            return self.snapshot()
        with self._model_lock:
            with self._lock:
                self._state = self._state.model_copy(update={"reloading": True, "reload_error": None, "timestamp": utc_now()})
            try:
                if not self._state.model_loaded:
                    self._backend.load()
                references: dict[str, list[np.ndarray]] = {}
                reference_files: set[Path] = set()
                skipped = 0
                directory = self.settings.face_known_dir
                logger.info("Loading known faces from %s", directory)
                if directory.exists() and not directory.is_dir():
                    raise FaceUnavailable("FACE_KNOWN_DIR doit être un dossier.")
                if directory.is_dir():
                    for identity in sorted(directory.iterdir()):
                        if not identity.is_dir() or identity.is_symlink() or identity.name.startswith("."):
                            continue
                        if identity.name.casefold() in {"unknown", "inconnu"}:
                            logger.warning("Reserved identity name skipped: %s", identity.name)
                            continue
                        vectors = []
                        for path in sorted(identity.iterdir()):
                            if not path.is_file() or path.is_symlink() or path.suffix.lower() not in IMAGE_EXTENSIONS:
                                continue
                            try:
                                image = self._backend.read_image(path)
                                if image is None:
                                    raise ValueError("Image illisible")
                                faces = self._backend.detect(image)
                                if len(faces) != 1:
                                    logger.warning("%s in file %s", "No face detected" if not faces else "Multiple faces detected", path)
                                    skipped += 1
                                    continue
                                face = faces[0]
                                if min(float(face[2]), float(face[3])) < self.settings.face_min_size:
                                    raise ValueError("Visage trop petit dans la photo de référence")
                                vectors.append(normalized_embedding(self._backend.embedding(image, face)))
                                reference_files.add(path)
                            except Exception as error:
                                skipped += 1
                                logger.warning("Reference image skipped %s: %s", path, error)
                        if vectors:
                            references[identity.name] = vectors
                            logger.info("Loaded %s: %s reference images", identity.name, len(vectors))
                with self._lock:
                    if self._shutdown.is_set():
                        return self.snapshot()
                    self._references = references
                    self._reference_files = reference_files
                    self._last_events.clear()
                    self._recent_faces.clear()
                    self._state = self._state.model_copy(update={"model_loaded": True, "known_identities": len(references),
                        "identities": sorted(references), "reference_images": sum(map(len, references.values())),
                        "skipped_images": skipped, "faces": [], "last_prediction_time": None,
                        "loaded_at": utc_now(), "timestamp": utc_now(), "error": None, "reload_error": None,
                        "status": "loading" if self._active else "stopped", "reloading": False,
                        "catalog_revision": self._state.catalog_revision + 1})
                logger.info("%s known identities ready", len(references))
            except Exception as error:
                logger.warning("Face catalog unavailable: %s", error)
                with self._lock:
                    self._state = self._state.model_copy(update={"reloading": False, "reload_error": str(error),
                        "error": str(error) if not self._state.model_loaded else self._state.error,
                        "status": "unavailable" if not self._state.model_loaded else self._state.status, "timestamp": utc_now()})
        return self.snapshot()

    def process(self, frame: Any, people: list[DetectedObject], session: int) -> FaceRecognitionResult:
        with self._model_lock:
            with self._lock:
                if not self._state.model_loaded or not self._active or session != self._session or self._shutdown.is_set():
                    return self.snapshot()
                revision = self._state.catalog_revision
                references = self._references
                previous = list(self._recent_faces)
            started = time.perf_counter()
            try:
                now = utc_now()
                detections: list[FaceDetection] = []
                used_ids: set[str] = set()
                for face in self._backend.detect(frame):
                    x, y, width, height = map(float, face[:4])
                    bbox = [max(0, x), max(0, y), min(frame.shape[1], x + width), min(frame.shape[0], y + height)]
                    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
                        continue
                    recognizable = min(bbox[2] - bbox[0], bbox[3] - bbox[1]) >= self.settings.face_min_size
                    name, score, reason = "Unknown", None, None
                    if recognizable:
                        try:
                            name, score = match_embedding(self._backend.embedding(frame, face), references, self.settings.face_threshold)
                        except ValueError:
                            recognizable = False
                            reason = "Visage non identifiable : alignement ou embedding invalide."
                    else:
                        reason = "Visage trop petit. Rapprochez-vous de la caméra."
                    if recognizable and not references:
                        reason = "Aucune identité connue configurée."
                    detection = FaceDetection(name=name, known=name != "Unknown", similarity=score,
                        confidence=max(0, score) if score is not None else 0, recognizable=recognizable, reason=reason,
                        detection_confidence=float(np.clip(face[-1], 0, 1)), bbox=bbox, timestamp=now,
                        tracker_id=associate_tracker(bbox, people))
                    candidates = [old for old in previous if old.face_id not in used_ids
                        and (now - old.timestamp).total_seconds() < 2
                        and ((detection.tracker_id is not None and old.tracker_id == detection.tracker_id) or overlap(old.bbox, bbox) >= .3)]
                    if candidates:
                        detection.face_id = max(candidates, key=lambda old: overlap(old.bbox, bbox)).face_id
                    used_ids.add(detection.face_id)
                    detections.append(detection)
                elapsed = round((time.perf_counter() - started) * 1000, 2)
            except Exception as error:
                with self._lock:
                    if session == self._session and self._active:
                        if self._state.error != str(error):
                            logger.warning("Face inference error: %s", error)
                        self._state = self._state.model_copy(update={"status": "error", "error": str(error), "faces": [],
                            "last_prediction_time": None, "timestamp": utc_now()})
                return self.snapshot()
        with self._lock:
            if session != self._session or revision != self._state.catalog_revision or not self._active or self._shutdown.is_set():
                return self.snapshot()
            event_time = time.monotonic()
            self._last_events = {key: stamp for key, stamp in self._last_events.items()
                                 if event_time - stamp < self.settings.face_event_cooldown}
            for detection in detections:
                key = f"known:{detection.name}" if detection.known else f"unknown:track:{detection.tracker_id}" if detection.tracker_id is not None else f"unknown:{detection.face_id}"
                if key in self._last_events:
                    continue
                self._last_events[key] = event_time
                self._history.appendleft(detection.model_copy(deep=True))
                if detection.known:
                    logger.info("Recognized %s similarity=%.2f", detection.name, detection.confidence)
                else:
                    logger.info("Unknown face detected%s", f" track={detection.tracker_id}" if detection.tracker_id is not None else "")
            current_ids = {face.face_id for face in detections}
            self._recent_faces = detections + [old for old in previous if old.face_id not in current_ids and (now - old.timestamp).total_seconds() < 2]
            self._state = self._state.model_copy(update={"status": "running", "faces": detections,
                "last_prediction_time": now, "timestamp": now, "inference_time_ms": elapsed, "error": None})
        return self.snapshot()
