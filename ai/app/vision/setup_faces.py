"""Explicit one-time download of pinned official OpenCV models; never run at startup."""
import hashlib
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen

from app.config import AI_ROOT

MODELS = (
    ("face_detection_yunet", "face_detection_yunet_2023mar.onnx", 232589,
     "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"),
    ("face_recognition_sface", "face_recognition_sface_2021dec.onnx", 38696353,
     "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"),
)


def download_models(directory: Path = AI_ROOT / "models") -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for family, filename, size, digest in MODELS:
        target = directory / filename
        license_path = directory / f"{family}.LICENSE"
        if not license_path.exists():
            with urlopen(f"https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/{family}/LICENSE", timeout=30) as response:
                license_path.write_bytes(response.read())
        if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
            print(f"[FACE] Model already verified: {filename}")
            continue
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=directory, suffix=".download", delete=False) as output:
                temporary = Path(output.name)
                url = f"https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/{family}/{filename}"
                with urlopen(url, timeout=60) as response:
                    while chunk := response.read(1024 * 1024):
                        output.write(chunk)
            if temporary.stat().st_size != size or hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
                raise RuntimeError(f"Official model checksum mismatch: {filename}")
            os.replace(temporary, target)
            print(f"[FACE] Downloaded and verified: {filename}")
        finally:
            if temporary and temporary.exists():
                temporary.unlink()


if __name__ == "__main__":
    download_models()
