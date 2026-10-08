from dataclasses import replace
import threading
import time
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas.vision import DetectedObject
from app.vision import face_recognition as module
from app.vision import camera
from app.vision.camera import CameraService
from app.vision.face_recognition import FaceRecognitionService, FaceUnavailable, associate_tracker, match_embedding, normalized_embedding


FACE = np.array([30, 20, 80, 80, 40, 40, 80, 40, 60, 60, 45, 80, 75, 80, .98], dtype=np.float32)
FRAME = np.zeros((240, 320, 3), dtype=np.uint8)


class FakeBackend:
    def __init__(self):
        self.faces = [FACE.copy()]
        self.vector = np.array([1., 0.])
        self.loaded = 0
        self.files = {}
        self.failure = None

    def load(self):
        self.loaded += 1
        if self.failure:
            raise self.failure

    def read_image(self, path):
        return path.name

    def detect(self, frame):
        return self.files.get(frame, [FACE]) if isinstance(frame, str) else self.faces

    def embedding(self, frame, face):
        return self.vector


def service(tmp_path, **options):
    backend = FakeBackend()
    settings = Settings(face_enabled=True, face_known_dir=tmp_path / 'known', **options)
    return FaceRecognitionService(settings, backend), backend


def add_photo(tmp_path, identity='Mohamed', filename='1.jpg'):
    folder = tmp_path / 'known' / identity
    folder.mkdir(parents=True, exist_ok=True)
    (folder / filename).write_bytes(b'fixture')


def test_cosine_matching_multiple_photos_threshold_and_unknown():
    refs = {'Mohamed': [normalized_embedding([1, 0]), normalized_embedding([0, 1])]}
    assert match_embedding([0, 2], refs, .55) == ('Mohamed', 1.)
    assert match_embedding([.55, np.sqrt(1 - .55 ** 2)], {'A': refs['Mohamed'][:1]}, .55)[0] == 'A'
    name, score = match_embedding([.4, np.sqrt(.84)], {'A': refs['Mohamed'][:1]}, .55)
    assert name == 'Unknown' and score == pytest.approx(.4)
    assert match_embedding([-1, 0], {'A': refs['Mohamed'][:1]}, .55) == ('Unknown', -1.)
    assert match_embedding([1, 0], {}, .55) == ('Unknown', None)
    assert match_embedding([1, 0], {'A': [np.array([1, 0, 0])]}, .55) == ('Unknown', None)
    for invalid in ([], [0, 0], [np.nan, 1], [np.inf, 0]):
        with pytest.raises(ValueError):
            normalized_embedding(invalid)


def test_reference_loading_skips_invalid_images_and_supports_unicode_names(tmp_path, caplog):
    faces, backend = service(tmp_path)
    for name in ('1.jpg', '2.jpg', '3.jpg', 'empty.jpg', 'multiple.jpg', 'tiny.jpg'):
        add_photo(tmp_path, 'Mohaméd', name)
    backend.files = {'empty.jpg': [], 'multiple.jpg': [FACE, FACE], 'tiny.jpg': [np.array([0, 0, 10, 10, .9])]}
    with caplog.at_level('INFO', logger='FACE'):
        result = faces.reload()
    assert result.model_loaded and result.known_identities == 1
    assert result.identities == ['Mohaméd'] and result.reference_images == 3 and result.skipped_images == 3
    assert 'Loaded Mohaméd: 3 reference images' in caplog.text
    assert 'No face detected in file' in caplog.text


def test_empty_catalog_detects_unknown_without_crashing(tmp_path):
    faces, _ = service(tmp_path)
    assert faces.reload().known_identities == 0
    session = faces.camera_started()
    result = faces.process(FRAME, [], session)
    assert result.status == 'running'
    assert result.faces[0].name == 'Unknown' and not result.faces[0].known
    assert result.faces[0].similarity is None and result.faces[0].confidence == 0


def test_history_cooldown_multiple_faces_tracker_and_stop(tmp_path, monkeypatch):
    faces, backend = service(tmp_path)
    add_photo(tmp_path)
    faces.reload()
    session = faces.camera_started()
    clock = [10.]
    monkeypatch.setattr(module.time, 'monotonic', lambda: clock[0])
    people = [DetectedObject(confidence=.9, bbox=[0, 0, 200, 200], track_id=7)]
    first = faces.process(FRAME, people, session)
    assert first.faces[0].name == 'Mohamed' and first.faces[0].tracker_id == 7
    for _ in range(5):
        faces.process(FRAME, people, session)
    assert len(faces.snapshot().history) == 1
    for _ in range(22):
        clock[0] += 5
        faces.process(FRAME, people, session)
    assert len(faces.snapshot().history) == 20
    faces.camera_stopped()
    assert not faces.snapshot().faces and len(faces.snapshot().history) == 20
    assert faces.process(FRAME, people, session).status == 'stopped'
    backend.vector = np.array([0, 1])
    new_session = faces.camera_started()
    unknown = faces.process(FRAME, people, new_session)
    assert not unknown.faces[0].known
    backend.faces = []
    faces.process(FRAME, people, new_session)
    backend.faces = [FACE]
    again = faces.process(FRAME, people, new_session)
    assert again.faces[0].face_id == unknown.faces[0].face_id
    assert len(again.history) == 20


def test_small_face_multiple_faces_and_tracker_containment(tmp_path):
    faces, backend = service(tmp_path)
    faces.reload()
    session = faces.camera_started()
    small = FACE.copy(); small[2:4] = 15
    other = FACE.copy(); other[0] = 180
    backend.faces = [small, other]
    result = faces.process(FRAME, [], session)
    assert len(result.faces) == 2 and not result.faces[0].recognizable
    assert 'petit' in result.faces[0].reason
    assert len({face.face_id for face in result.faces}) == 2
    people = [DetectedObject(confidence=.9, bbox=[0, 0, 300, 240], track_id=1),
              DetectedObject(confidence=.9, bbox=[20, 10, 150, 150], track_id=7)]
    assert associate_tracker([30, 20, 110, 100], people) == 7
    assert associate_tracker([310, 20, 320, 100], people) is None


def test_reload_adds_and_removes_identities_and_preserves_history(tmp_path):
    faces, _ = service(tmp_path)
    add_photo(tmp_path)
    assert faces.reload().catalog_revision == 1
    session = faces.camera_started()
    faces.process(FRAME, [], session)
    add_photo(tmp_path, 'Personne2')
    reloaded = faces.reload()
    assert reloaded.known_identities == 2 and reloaded.catalog_revision == 2
    assert len(reloaded.history) == 1 and not reloaded.faces
    (tmp_path / 'known' / 'Mohamed' / '1.jpg').unlink()
    assert faces.reload().identities == ['Personne2']
    (tmp_path / 'known' / 'Personne2' / '1.jpg').unlink()
    assert faces.reload().known_identities == 0


def test_model_unavailable_disabled_and_failed_reload_are_explicit(tmp_path):
    faces, backend = service(tmp_path)
    backend.failure = FaceUnavailable('missing model')
    assert faces.reload().status == 'unavailable'
    backend.failure = None
    add_photo(tmp_path)
    assert faces.reload().known_identities == 1
    # A bad replacement directory must preserve the last valid catalog.
    invalid = tmp_path / 'file'; invalid.write_text('bad directory')
    faces.settings = replace(faces.settings, face_known_dir=invalid)
    result = faces.reload()
    assert result.known_identities == 1 and result.reload_error and result.model_loaded
    disabled = FaceRecognitionService(replace(faces.settings, face_enabled=False), backend)
    assert disabled.reload().status == 'disabled'


def test_stopped_inference_cannot_republish_after_restart(tmp_path):
    faces, backend = service(tmp_path)
    faces.reload()
    old_session = faces.camera_started()
    entered, finish = threading.Event(), threading.Event()
    original = backend.embedding
    def blocked(*args):
        entered.set(); finish.wait(3)
        return original(*args)
    backend.embedding = blocked
    worker = threading.Thread(target=faces.process, args=(FRAME, [], old_session))
    worker.start()
    assert entered.wait(1)
    faces.camera_stopped()
    faces.camera_started()
    finish.set(); worker.join(2)
    assert not faces.snapshot().faces and not faces.snapshot().history


def test_face_routes_are_authenticated_reloadable_and_embedded_in_vision(tmp_path):
    settings = Settings(face_enabled=True, face_known_dir=tmp_path / 'known', service_token='face-token')
    api = create_app(settings)
    backend = FakeBackend()
    api.state.engine.camera.faces = FaceRecognitionService(settings, backend)
    with TestClient(api) as client:
        headers = {'Authorization': 'Bearer face-token'}
        for path in ('status', 'latest', 'history'):
            assert client.get(f'/vision/faces/{path}').status_code == 401
            assert client.get(f'/vision/faces/{path}', headers=headers).status_code == 200
        assert client.post('/vision/faces/reload').status_code == 401
        add_photo(tmp_path)
        result = client.post('/vision/faces/reload', headers=headers).json()
        assert result['known_identities'] == 1 and result['identities'] == ['Mohamed']
        assert client.get('/vision/status', headers=headers).json()['faces']['known_identities'] == 1
        assert client.get('/status', headers=headers).json()['vision']['faces']['known_identities'] == 1
        prediction = client.post('/analyze', headers=headers, json={'temperature': 22}).json()
        assert prediction['vision']['faces'] is None


@pytest.mark.parametrize('mode', ['missing', 'slow'])
def test_missing_or_slow_facial_model_does_not_block_capture_or_yolo(tmp_path, monkeypatch, mode):
    settings = Settings(face_enabled=True, face_known_dir=tmp_path / 'known', face_max_fps=15, vision_max_fps=60)
    backend = FakeBackend()
    entered, finish = threading.Event(), threading.Event()
    if mode == 'missing':
        backend.failure = FaceUnavailable('missing facial model')
    else:
        original = backend.embedding
        def blocked(*args):
            entered.set(); finish.wait(3)
            return original(*args)
        backend.embedding = blocked

    class Capture:
        released = False
        def isOpened(self): return True
        def set(self, *args): pass
        def read(self): return (not self.released, FRAME.copy())
        def release(self): self.released = True

    class Detector:
        def __init__(self, *args): pass
        def load(self): pass
        def detect(self, frame): return [DetectedObject(confidence=.9, bbox=[0, 0, 200, 200], track_id=7)]

    fake_cv = SimpleNamespace(VideoCapture=lambda *args: Capture(), CAP_DSHOW=700,
        CAP_PROP_FRAME_WIDTH=3, CAP_PROP_FRAME_HEIGHT=4, FONT_HERSHEY_SIMPLEX=0, IMWRITE_JPEG_QUALITY=1,
        resize=lambda frame, size: frame, rectangle=lambda *args: None, putText=lambda *args: None,
        imencode=lambda *args: (True, SimpleNamespace(tobytes=lambda: b'jpeg')))
    original_import = module.importlib.import_module
    monkeypatch.setattr(module.importlib, 'import_module', lambda name: fake_cv if name == 'cv2' else original_import(name))
    monkeypatch.setattr(camera, 'PersonDetector', Detector)
    webcam = CameraService(settings)
    webcam.faces = FaceRecognitionService(settings, backend)
    try:
        webcam.start()
        deadline = time.monotonic() + 3
        while not webcam.snapshot().confirmed or (mode == 'slow' and not entered.is_set()) or (mode == 'missing' and webcam.faces.snapshot().status != 'unavailable'):
            assert time.monotonic() < deadline
            time.sleep(.005)
        version = webcam.jpeg_version
        time.sleep(.06)
        assert webcam.jpeg_version > version
        assert webcam.snapshot().status == 'running' and webcam.snapshot().detection_status == 'running'
        assert webcam.get_jpeg() == b'jpeg'
    finally:
        finish.set()
        webcam.stop()
        webcam.faces.shutdown()
