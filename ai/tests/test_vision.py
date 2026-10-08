"""Vision tests use fake models/devices and never need a physical webcam."""

import importlib
import os
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.config import Settings
from app.schemas.vision import DetectedObject
from app.vision import camera
from app.vision.camera import CameraService
from app.vision.person_detector import PersonDetector, VisionUnavailable
from app.vision.tracker import PresenceConfirmation


@pytest.fixture(autouse=True)
def isolate_person_pipeline(monkeypatch):
    monkeypatch.setenv("FACE_RECOGNITION_ENABLED", "false")


def person(track_id: int | None = None) -> DetectedObject:
    return DetectedObject(confidence=0.91, bbox=[10, 20, 120, 200], track_id=track_id)


def wait_until(predicate, timeout: float = 3.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() >= deadline:
            pytest.fail("Background vision worker did not reach the expected state")
        time.sleep(0.005)


def test_presence_needs_consecutive_frames_and_clears_immediately():
    confirmation = PresenceConfirmation(required_frames=3)
    assert not confirmation.update([person()])
    assert not confirmation.update([])
    assert not confirmation.update([person()])
    assert not confirmation.update([person()])
    assert confirmation.update([person()])
    assert not confirmation.update([])
    assert not confirmation.update([person()])


def test_tracking_does_not_confirm_different_people_across_frames():
    confirmation = PresenceConfirmation(required_frames=3)
    assert not confirmation.update([person(1)])
    assert not confirmation.update([person(2)])
    assert not confirmation.update([person(1)])
    assert not confirmation.update([person(1), person(3)])
    assert confirmation.update([person(1)])
    assert not confirmation.update([])


def test_missing_weights_do_not_import_or_download_yolo(tmp_path, monkeypatch):
    detector = PersonDetector(tmp_path / "missing.pt")
    imports = []
    monkeypatch.setattr(importlib, "import_module", lambda name: imports.append(name))
    with pytest.raises(VisionUnavailable, match="weights missing"):
        detector.load()
    assert imports == []


def test_yolo_config_preserves_user_override_and_disables_auto_install(tmp_path, monkeypatch):
    weights = tmp_path / "local.pt"
    weights.write_bytes(b"fake-weights")
    config_dir = tmp_path / "custom-settings"
    monkeypatch.setenv("YOLO_CONFIG_DIR", str(config_dir))
    monkeypatch.setenv("YOLO_AUTOINSTALL", "True")
    loaded = []
    monkeypatch.setattr(importlib, "import_module", lambda name: SimpleNamespace(YOLO=lambda path: loaded.append(path)))
    PersonDetector(weights).load()
    assert config_dir.is_dir()
    assert os.environ["YOLO_CONFIG_DIR"] == str(config_dir)
    assert os.environ["YOLO_AUTOINSTALL"] == "False"
    assert loaded == [str(weights.resolve())]


def test_tracking_failure_falls_back_to_person_only_predictions(tmp_path):
    calls = []

    class FakeYOLO:
        predictor = object()
        callbacks_dirty = False

        def track(self, **options):
            calls.append(("track", options))
            self.callbacks_dirty = True
            raise ModuleNotFoundError("Optional ByteTrack dependency unavailable")

        def reset_callbacks(self):
            self.callbacks_dirty = False

        def predict(self, **options):
            assert not self.callbacks_dirty
            assert self.predictor is None
            assert options["mode"] == "predict"
            calls.append(("predict", options))
            boxes = SimpleNamespace(
                xyxy=[[10, 20, 120, 200], [1, 2, 3, 4], [1, 2, 3, 4]],
                conf=[0.91, 0.99, 0.2], cls=[0, 2, 0], id=None,
            )
            return [SimpleNamespace(boxes=boxes)]

    detector = PersonDetector(tmp_path / "local.pt", confidence=0.55)
    detector._model = FakeYOLO()
    assert len(detector.detect(object())) == 1
    assert len(detector.detect(object())) == 1
    assert [method for method, _ in calls] == ["track", "predict", "predict"]
    assert calls[0][1]["persist"] is True
    assert calls[0][1]["tracker"] == "bytetrack.yaml"
    assert all(options["classes"] == [0] and options["conf"] == 0.55 for _, options in calls)


def test_missing_opencv_is_unavailable_without_crashing(tmp_path, monkeypatch):
    original_import = importlib.import_module

    def fake_import(name, *args, **kwargs):
        if name == "cv2":
            raise ModuleNotFoundError("cv2")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(importlib, "import_module", fake_import)
    updates = []
    service = CameraService(Settings(yolo_model=tmp_path / "local.pt"), updates.append)
    service.start()
    wait_until(lambda: service.snapshot().status == "unavailable")
    assert "OpenCV" in service.snapshot().error
    assert [update.status for update in updates] == ["starting", "unavailable"]
    assert service.get_jpeg() is None
    assert service.stop().status == "stopped"


def test_starting_callback_can_cancel_start_without_deadlocking():
    updates = []

    def update(result):
        updates.append(result.status)
        if result.status == "starting":
            service.stop()

    service = CameraService(Settings(), update)
    assert service.start().status == "stopped"
    assert updates == ["starting", "stopped"]
    assert service._thread is None


def test_unavailable_camera_scans_and_releases_every_candidate(monkeypatch):
    candidates = []

    class UnavailableCapture:
        def __init__(self, *args):
            self.args = args
            self.released = False
            candidates.append(self)

        def isOpened(self):
            return False

        def release(self):
            self.released = True

    cv2 = SimpleNamespace(VideoCapture=UnavailableCapture, CAP_DSHOW=700)
    monkeypatch.setattr(camera.sys, "platform", "win32")
    service = CameraService(Settings(camera_index=2, camera_scan_limit=3))
    with pytest.raises(VisionUnavailable, match="Webcam introuvable"):
        service._open_camera(cv2, threading.Event())
    assert [candidate.args for candidate in candidates] == [(2, 700), (2,), (0, 700), (0,), (1, 700), (1,)]
    assert all(candidate.released for candidate in candidates)


def test_windows_camera_uses_default_backend_when_directshow_cannot_read(monkeypatch):
    candidates = []

    class Capture:
        def __init__(self, *args):
            self.args = args
            self.released = False
            candidates.append(self)

        def isOpened(self):
            return True

        def set(self, *args):
            pass

        def read(self):
            return (False, None) if len(self.args) == 2 else (True, object())

        def release(self):
            self.released = True

    cv2 = SimpleNamespace(VideoCapture=Capture, CAP_DSHOW=700, CAP_PROP_FRAME_WIDTH=3, CAP_PROP_FRAME_HEIGHT=4)
    monkeypatch.setattr(camera.sys, "platform", "win32")
    service = CameraService(Settings(camera_index=-1, camera_scan_limit=2))
    capture, index, first_frame = service._open_camera(cv2, threading.Event())
    assert index == 0
    assert first_frame is not None
    assert capture.args == (0,)
    assert candidates[0].released
    capture.release()


def test_worker_confirms_encodes_once_and_can_restart(tmp_path, monkeypatch):
    captures = []
    detections = []
    updates = []

    class Frame:
        def copy(self):
            return self

    class Capture:
        def __init__(self, *args):
            self.released = False
            self.frames = 0
            captures.append(self)

        def isOpened(self):
            return True

        def set(self, *args):
            pass

        def read(self):
            self.frames += 1
            return (False, None) if self.released else (True, Frame())

        def release(self):
            self.released = True

    class Detector:
        def __init__(self, *args):
            pass

        def load(self):
            pass

        def detect(self, frame):
            detections.append(frame)
            return [person(7)]

    sizes = []
    cv2 = SimpleNamespace(
        VideoCapture=Capture, CAP_DSHOW=700, CAP_PROP_FRAME_WIDTH=3, CAP_PROP_FRAME_HEIGHT=4,
        FONT_HERSHEY_SIMPLEX=0, IMWRITE_JPEG_QUALITY=1,
        resize=lambda frame, size: sizes.append(size) or frame,
        rectangle=lambda *args: None, putText=lambda *args: None,
        imencode=lambda *args: (True, SimpleNamespace(tobytes=lambda: b"annotated-jpeg")),
    )
    original_import = importlib.import_module
    monkeypatch.setattr(importlib, "import_module", lambda name: cv2 if name == "cv2" else original_import(name))
    monkeypatch.setattr(camera, "PersonDetector", Detector)
    service = CameraService(
        Settings(yolo_model=Path(tmp_path / "unused.pt"), vision_max_fps=100, vision_frame_stride=3),
        on_update=updates.append,
    )
    unblock = threading.Event()
    try:
        service.start()
        service.start()  # Starting twice shares the same camera worker.
        wait_until(lambda: service.snapshot().confirmed and service.get_jpeg() is not None)
        assert len(captures) == 1
        assert captures[0].frames > len(detections)
        assert service.get_jpeg() == b"annotated-jpeg"
        assert service.jpeg_version > 0
        assert all(size == (640, 480) for size in sizes)
        snapshot = service.snapshot()
        assert snapshot.person_count == 1 and snapshot.last_prediction_time is not None
        assert snapshot.fps > 0 and snapshot.inference_time_ms >= 0
        snapshot.objects.clear()
        assert len(service.snapshot().objects) == 1
        assert service.stop().status == "stopped"
        assert captures[0].released and service.get_jpeg() is None
        service.start()
        wait_until(lambda: service.snapshot().confirmed)
        assert len(captures) == 2
        service.stop()

        # A slow first inference can outlive stop()'s bounded join. It must not
        # restore confirmed presence or block raw video after the stop response.
        blocked = threading.Event()
        original_detect = Detector.detect

        def slow_detect(self, frame):
            blocked.set()
            unblock.wait(timeout=5.0)
            return [person(9)]

        monkeypatch.setattr(Detector, "detect", slow_detect)
        service.start()
        wait_until(blocked.is_set)
        assert service.stop().status == "stopped"
        service.start()
        wait_until(lambda: service.snapshot().status == "running")
        assert len(captures) == 4
        assert not service.snapshot().confirmed
        assert service.get_jpeg() is not None
        monkeypatch.setattr(Detector, "detect", original_detect)
        unblock.set()
        wait_until(lambda: service.snapshot().confirmed)
        assert service.snapshot().objects[0].track_id == 7
        assert len(captures) == 4
    finally:
        unblock.set()
        service.stop()
    assert all(capture.released for capture in captures)
    assert updates[-1].status == "stopped"


@pytest.mark.parametrize("failure", ["missing-model", "slow-load", "broken-inference"])
def test_video_continues_when_detection_cannot_run(failure, monkeypatch):
    import numpy as np
    cv2 = pytest.importorskip("cv2")

    loading = threading.Event()
    unblock = threading.Event()
    captures = []

    class Capture:
        def __init__(self, *args):
            self.releases = 0
            captures.append(self)

        def isOpened(self):
            return True

        def set(self, *args):
            pass

        def read(self):
            return True, np.zeros((480, 640, 3), dtype=np.uint8)

        def release(self):
            self.releases += 1

    class Detector:
        def __init__(self, *args):
            pass

        def load(self):
            loading.set()
            if failure == "missing-model":
                raise VisionUnavailable("YOLO weights missing")
            if failure == "slow-load":
                unblock.wait(timeout=5)

        def detect(self, frame):
            if failure == "broken-inference":
                raise RuntimeError("YOLO inference failed")
            return []

    monkeypatch.setattr(cv2, "VideoCapture", Capture)
    monkeypatch.setattr(camera, "PersonDetector", Detector)
    service = CameraService(Settings(vision_frame_stride=1, vision_max_fps=30))
    try:
        service.start()
        wait_until(loading.is_set)
        expected = {"missing-model": "unavailable", "slow-load": "loading", "broken-inference": "error"}[failure]
        wait_until(lambda: service.snapshot().detection_status == expected)
        version = service.jpeg_version
        wait_until(lambda: service.jpeg_version >= version + 3)
        state = service.snapshot()
        assert state.status == "running" and state.stream_ready
        assert state.last_frame_time is not None and state.camera_index == 0
        assert not state.confirmed and state.person_count == 0
        assert service.get_jpeg().startswith(b"\xff\xd8")
        service.start()
        assert len(captures) == 1
    finally:
        unblock.set()
        service.stop()
    assert service.stop().status == "stopped"
    assert service.get_jpeg() is None and not service.snapshot().stream_ready
    assert captures[0].releases == 1


def test_running_requires_a_first_readable_frame(monkeypatch):
    opened = threading.Event()
    unblock = threading.Event()
    frame = object()

    class Capture:
        def __init__(self, *args):
            pass

        def isOpened(self):
            return True

        def set(self, *args):
            pass

        def read(self):
            opened.set()
            unblock.wait(timeout=5)
            return True, frame

        def release(self):
            pass

    cv2 = SimpleNamespace(VideoCapture=Capture, CAP_DSHOW=700, CAP_PROP_FRAME_WIDTH=3, CAP_PROP_FRAME_HEIGHT=4)
    original_import = importlib.import_module
    monkeypatch.setattr(importlib, "import_module", lambda name: cv2 if name == "cv2" else original_import(name))
    service = CameraService(Settings())
    try:
        service.start()
        wait_until(opened.is_set)
        assert service.snapshot().status == "starting"
        assert not service.snapshot().stream_ready and service.get_jpeg() is None
        service.stop()
        unblock.set()
        wait_until(lambda: service._thread is None)
        assert service.snapshot().status == "stopped"
    finally:
        unblock.set()
        service.stop()
