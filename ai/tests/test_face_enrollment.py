"""Reference enrollment uses temporary catalogues and a deterministic face backend."""
import base64
from io import BytesIO
import json
from pathlib import Path

import numpy as np
from PIL import Image
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.schemas.face import FaceEnrollmentRequest, MAX_FACE_BODY_BYTES, MAX_FACE_IMAGE_BYTES
from app.vision.face_enrollment import EnrollmentError, identity_name, normalized_photo
from app.vision.face_recognition import FaceRecognitionService, FaceUnavailable


FACE = np.array([10, 10, 80, 80, 30, 30, 70, 30, 50, 50, 35, 70, 65, 70, .99], dtype=np.float32)


def photo(value=150, filename="photo.jpg", size=(120, 120), format="JPEG"):
    buffer = BytesIO()
    Image.new("RGB", size, (value, value, value)).save(buffer, format=format)
    return {"filename": filename, "content_base64": base64.b64encode(buffer.getvalue()).decode("ascii")}


def enrollment(name="Mohamed", images=None):
    return FaceEnrollmentRequest.model_validate({"name": name, "images": images or [photo()]})


class Backend:
    def load(self):
        pass

    def read_image(self, path):
        with Image.open(path) as image:
            return np.array(image)

    def detect(self, image):
        shade = round(float(image.mean()))
        if shade == 10:
            return []
        if shade == 40:
            return [FACE, FACE]
        if shade == 70:
            small = FACE.copy()
            small[2:4] = 10
            return [small]
        return [FACE]

    def embedding(self, image, face):
        return np.zeros(2) if round(float(image.mean())) == 100 else np.array([1., 0.])


@pytest.fixture
def faces(tmp_path):
    return FaceRecognitionService(Settings(face_known_dir=tmp_path / "known", face_enabled=True), Backend())


@pytest.mark.parametrize("name", ["../Alice", "A/B", "A\\B", "C:Alice", "Unknown", "inCONnu", "CON", "NUL", "COM1", "LPT²", ".Alice", "Alice.", " ", "___", "A\nB", "A" * 65])
def test_unsafe_names_cannot_become_directories(faces, name):
    with pytest.raises(EnrollmentError):
        faces.enroll(enrollment(name))
    assert not faces.settings.face_known_dir.exists()


def test_name_normalization_and_accents():
    assert identity_name("  Mohame\u0301d  ") == "Mohaméd"
    assert identity_name("Anne-Marie O'Neil_2") == "Anne-Marie O'Neil_2"
    assert identity_name("محمد") == "محمد"


def test_upload_one_then_multiple_images_appends_and_reloads(faces):
    first = faces.enroll(enrollment("Mohaméd"))
    assert first.name == "Mohaméd" and first.added == 1 and not first.rejected
    assert first.catalog.known_identities == 1 and first.catalog.reference_images == 1
    original = list((faces.settings.face_known_dir / "Mohaméd").glob("*.jpg"))[0]
    original_content = original.read_bytes()
    second = faces.enroll(enrollment("mohaméd", [photo(160, "same.jpg"), photo(170, "same.jpg")]))
    assert second.name == "Mohaméd" and second.added == 2
    assert second.catalog.identities == ["Mohaméd"] and second.catalog.reference_images == 3
    assert second.catalog.catalog_revision > first.catalog.catalog_revision
    assert original.read_bytes() == original_content
    assert len(list(original.parent.glob("*.jpg"))) == 3
    assert not list(faces.settings.face_known_dir.glob(".enroll-*"))


def test_invalid_faces_are_reported_individually_and_not_saved(faces):
    result = faces.enroll(enrollment(images=[photo(10, "absent.jpg"), photo(40, "group.jpg"),
                                            photo(70, "tiny.jpg"), photo(100, "embedding.jpg"), photo(150, "good.jpg")]))
    assert result.added == 1 and len(result.rejected) == 4
    assert "Aucun visage" in result.rejected[0].message
    assert "Plusieurs visages" in result.rejected[1].message
    assert "petit" in result.rejected[2].message
    assert result.catalog.reference_images == 1
    assert len(list((faces.settings.face_known_dir / "Mohamed").glob("*.jpg"))) == 1


def test_all_rejected_does_not_create_an_identity_or_change_valid_catalogue(faces):
    existing = faces.enroll(enrollment())
    result = faces.enroll(enrollment("Other", [photo(10)]))
    assert result.added == 0 and len(result.rejected) == 1
    assert result.catalog.catalog_revision == existing.catalog.catalog_revision
    assert result.catalog.identities == ["Mohamed"]
    assert not (faces.settings.face_known_dir / "Other").exists()


def test_corrupt_and_fake_images_are_rejected_without_writes(faces):
    fake = {"filename": "fake.jpg", "content_base64": base64.b64encode(b"not an image").decode()}
    result = faces.enroll(enrollment(images=[fake]))
    assert result.added == 0 and "illisible" in result.rejected[0].message
    assert not (faces.settings.face_known_dir / "Mohamed").exists()


@pytest.mark.parametrize("filename,content", [("../face.jpg", "YWJj"), ("face.svg", "YWJj"),
                                             ("face.jpg", "!!bad!!"), ("face.jpg", "Zg==\n"),
                                             ("face.jpg", "Zh==")])
def test_invalid_payload_rejected_before_any_directory_write(faces, filename, content):
    with pytest.raises(EnrollmentError):
        faces.enroll(enrollment(images=[{"filename": filename, "content_base64": content}]))
    assert not faces.settings.face_known_dir.exists()


def test_decoder_bounds_resolution_before_loading_pixels():
    oversized = photo(size=(4097, 1), format="PNG")
    with pytest.raises(ValueError, match="grande"):
        normalized_photo(base64.b64decode(oversized["content_base64"]))


def test_common_phone_resolution_is_supported_but_pixel_limit_is_enforced():
    phone = photo(size=(4032, 3024))
    with Image.open(BytesIO(normalized_photo(base64.b64decode(phone["content_base64"])))) as normalized:
        assert max(normalized.size) == 1600
    oversized = photo(size=(4096, 4096))
    with pytest.raises(ValueError, match="grande"):
        normalized_photo(base64.b64decode(oversized["content_base64"]))


def test_decoded_image_and_batch_size_limits_precede_image_processing(faces):
    too_big = base64.b64encode(b"x" * (MAX_FACE_IMAGE_BYTES + 1)).decode()
    with pytest.raises(EnrollmentError) as error:
        faces.enroll(enrollment(images=[{"filename": "large.jpg", "content_base64": too_big}]))
    assert error.value.status_code == 413
    maximum = base64.b64encode(b"x" * MAX_FACE_IMAGE_BYTES).decode()
    images = [{"filename": f"photo{index}.jpg", "content_base64": maximum} for index in range(4)]
    with pytest.raises(EnrollmentError) as error:
        faces.enroll(enrollment(images=images))
    assert error.value.status_code == 413
    assert not faces.settings.face_known_dir.exists()


def test_orientation_and_metadata_are_normalized_and_output_is_bounded_jpeg():
    source = Image.new("RGB", (40, 80), "red")
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "private metadata"
    encoded = BytesIO()
    source.save(encoded, format="JPEG", exif=exif)
    with Image.open(BytesIO(normalized_photo(encoded.getvalue()))) as normalized:
        assert normalized.format == "JPEG" and normalized.size == (80, 40)
        assert not normalized.getexif()
    large = photo(size=(2400, 1200), format="PNG")
    with Image.open(BytesIO(normalized_photo(base64.b64decode(large["content_base64"])))) as resized:
        assert resized.size == (1600, 800)


@pytest.mark.parametrize("format,extension", [("PNG", ".png"), ("WEBP", ".webp")])
def test_supported_formats_are_saved_as_valid_jpegs(faces, format, extension):
    assert faces.enroll(enrollment(images=[photo(filename="input" + extension, format=format)])).added == 1
    for path in (faces.settings.face_known_dir / "Mohamed").iterdir():
        with Image.open(path) as stored:
            assert stored.format == "JPEG"


def test_missing_model_and_disabled_module_do_not_save_references(faces):
    def unavailable():
        raise FaceUnavailable("missing facial model")
    faces._backend.load = unavailable
    with pytest.raises(FaceUnavailable, match="missing facial model"):
        faces.enroll(enrollment())
    assert not faces.settings.face_known_dir.exists()
    disabled = FaceRecognitionService(Settings(face_known_dir=faces.settings.face_known_dir, face_enabled=False), Backend())
    with pytest.raises(FaceUnavailable, match="désactivée"):
        disabled.enroll(enrollment())


def test_failed_write_rolls_back_only_new_files(faces, monkeypatch):
    faces.enroll(enrollment())
    destination = faces.settings.face_known_dir / "Mohamed"
    original = {path.name: path.read_bytes() for path in destination.iterdir()}
    real_open = Path.open
    count = 0

    def failing_open(path, *args, **kwargs):
        nonlocal count
        if path.parent == destination and args and args[0] == "xb":
            count += 1
            if count == 2:
                raise OSError("simulated disk failure")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", failing_open)
    with pytest.raises(OSError, match="disk failure"):
        faces.enroll(enrollment(images=[photo(), photo()]))
    assert {path.name: path.read_bytes() for path in destination.iterdir()} == original
    assert faces.snapshot().reference_images == 1
    assert not list(faces.settings.face_known_dir.glob(".enroll-*"))


def test_failed_reference_reload_rolls_back_new_photos_and_keeps_existing_identity(faces, monkeypatch):
    faces.enroll(enrollment())
    destination = faces.settings.face_known_dir / "Mohamed"
    original = {path.name: path.read_bytes() for path in destination.iterdir()}
    read_image = faces._backend.read_image

    def unreadable_new_reference(path):
        if path.parent == destination and path.name not in original:
            return None
        return read_image(path)

    monkeypatch.setattr(faces._backend, "read_image", unreadable_new_reference)
    with pytest.raises(FaceUnavailable, match="catalogue"):
        faces.enroll(enrollment(images=[photo(filename="new.jpg")]))
    assert {path.name: path.read_bytes() for path in destination.iterdir()} == original
    assert faces.snapshot().reference_images == 1
    assert faces.snapshot().identities == ["Mohamed"]
    assert not list(faces.settings.face_known_dir.glob(".enroll-*"))


def test_symlink_identity_cannot_escape_the_catalogue(faces, tmp_path):
    root = faces.settings.face_known_dir
    root.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (root / "Mohamed").symlink_to(outside, target_is_directory=True)
    except OSError:
        pytest.skip("Creating directory symlinks requires Windows developer privileges")
    with pytest.raises(EnrollmentError, match="dossier"):
        faces.enroll(enrollment())
    assert not list(outside.iterdir())


def test_authenticated_api_upload_reloads_catalogue_and_keeps_camera_stopped(tmp_path):
    settings = Settings(face_known_dir=tmp_path / "known", face_enabled=True, service_token="enroll-token")
    api = create_app(settings)
    api.state.engine.camera.faces = FaceRecognitionService(settings, Backend())
    headers = {"Authorization": "Bearer enroll-token"}
    body = {"name": "Mohamed", "images": [photo(), photo(filename="other.png", format="PNG")]}
    with TestClient(api) as client:
        assert client.post("/vision/faces/enroll", json=body).status_code == 401
        assert not settings.face_known_dir.exists()
        response = client.post("/vision/faces/enroll", headers=headers, json=body)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["added"] == 2 and result["catalog"]["identities"] == ["Mohamed"]
        assert result["catalog"]["status"] == "stopped"
        assert client.get("/vision/faces/status", headers=headers).json()["reference_images"] == 2
        assert client.get("/vision/status", headers=headers).json()["status"] == "stopped"
        assert client.post("/vision/faces/enroll", headers=headers, json={"name": "../Alice", "images": [photo()]}).status_code == 422
        invalid = client.post("/vision/faces/enroll", headers=headers, json={"name": "Alice", "images": []})
        assert invalid.status_code == 422 and "content_base64" not in invalid.text
        assert client.post("/vision/faces/enroll", headers=headers, content="not JSON").status_code == 415


def test_api_limits_request_bytes_and_does_not_echo_photos(tmp_path):
    settings = Settings(face_known_dir=tmp_path / "known", face_enabled=True, service_token="token")
    api = create_app(settings)
    with TestClient(api) as client:
        headers = {"Authorization": "Bearer token", "Content-Type": "application/json"}
        oversized = b" " * (MAX_FACE_BODY_BYTES + 1)
        assert client.post("/vision/faces/enroll", content=oversized,
                           headers={"Content-Type": "application/json"}).status_code == 401
        assert client.post("/vision/faces/enroll", headers=headers, content=oversized).status_code == 413
        invalid = {"name": "Alice", "images": [{"filename": "secret.jpg", "content_base64": 123456789}]}
        response = client.post("/vision/faces/enroll", headers=headers, content=json.dumps(invalid))
        assert response.status_code == 422 and "123456789" not in response.text
