"""Validate local reference uploads before the face service writes its catalogue."""
import base64
import binascii
from io import BytesIO
from pathlib import Path
import unicodedata
import warnings

from app.schemas.face import FaceEnrollmentRequest, MAX_FACE_IMAGE_BYTES, MAX_FACE_TOTAL_BYTES


class EnrollmentError(ValueError):
    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.status_code = status_code


RESERVED_NAMES = {"unknown", "inconnu", "con", "prn", "aux", "nul"} | {
    prefix + suffix for prefix in ("com", "lpt") for suffix in (*"123456789", "¹", "²", "³")
}


def identity_name(value: str) -> str:
    name = unicodedata.normalize("NFC", value.strip())
    def alphanumeric(char):
        return unicodedata.category(char)[0] in "LN"
    if (not 1 <= len(name) <= 64 or not any(alphanumeric(char) for char in name)
            or any(not alphanumeric(char) and char not in " _-'" for char in name)
            or name.casefold() in RESERVED_NAMES):
        raise EnrollmentError("Nom invalide : 1 à 64 caractères, lettres, chiffres, espaces, tirets ou apostrophes ; nom réservé interdit.")
    return name


def uploaded_images(request: FaceEnrollmentRequest) -> tuple[str, list[tuple[str, bytes]]]:
    name = identity_name(request.name)
    images = []
    total = 0
    for photo in request.images:
        filename = photo.filename
        if (any(char in filename for char in "/\\")
                or any(unicodedata.category(char) == "Cc" for char in filename)
                or Path(filename).suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}):
            raise EnrollmentError("Chaque fichier doit être une photo JPEG, PNG ou WebP avec un nom simple.")
        try:
            content = base64.b64decode(photo.content_base64, validate=True)
        except (ValueError, binascii.Error) as error:
            raise EnrollmentError("Le contenu d'une photo n'est pas un encodage base64 valide.") from error
        if not content or base64.b64encode(content).decode("ascii") != photo.content_base64:
            raise EnrollmentError("Le contenu d'une photo est vide ou mal encodé.")
        if len(content) > MAX_FACE_IMAGE_BYTES:
            raise EnrollmentError("Chaque photo doit faire au maximum 5 Mio.", 413)
        total += len(content)
        if total > MAX_FACE_TOTAL_BYTES:
            raise EnrollmentError("Les photos doivent faire au maximum 15 Mio au total.", 413)
        images.append((filename, content))
    return name, images


def normalized_photo(content: bytes) -> bytes:
    # Pillow is already a YOLO dependency; keep it lazy for sensor-only installs.
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(content)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Format non pris en charge : utilisez JPEG, PNG ou WebP.")
                width, height = image.size
                if max(width, height) > 4096 or width * height > 16_000_000:
                    raise ValueError("Photo trop grande : maximum 4096 pixels par côté et 16 mégapixels.")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Utilisez une photo fixe, pas une image animée.")
                # Apply phone orientation, bound inference cost, and strip EXIF/GPS.
                reference = ImageOps.exif_transpose(image).convert("RGB")
                reference.thumbnail((1600, 1600))
                output = BytesIO()
                reference.save(output, format="JPEG", quality=95)
                return output.getvalue()
    except (Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise ValueError("Photo trop grande : réduisez sa résolution.") from error
    except (UnidentifiedImageError, OSError, SyntaxError) as error:
        raise ValueError("Photo illisible ou endommagée.") from error


def is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def identity_directory(root: Path, name: str) -> Path:
    if is_link(root) or (root.exists() and not root.is_dir()):
        raise EnrollmentError("Le dossier des visages connus doit être un dossier local accessible.", 503)
    root.mkdir(parents=True, exist_ok=True)
    matches = [entry for entry in root.iterdir()
               if unicodedata.normalize("NFC", entry.name).lower() == name.lower()]
    if len(matches) > 1:
        raise EnrollmentError("Plusieurs dossiers correspondent à ce nom. Vérifiez le catalogue existant.")
    folder = matches[0] if matches else root / name
    if is_link(folder) or (folder.exists() and not folder.is_dir()) or folder.resolve().parent != root.resolve():
        raise EnrollmentError("Ce nom ne correspond pas à un dossier de référence accessible.")
    return folder
