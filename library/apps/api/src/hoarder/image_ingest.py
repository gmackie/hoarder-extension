from dataclasses import dataclass
from io import BytesIO

from PIL import Image, UnidentifiedImageError


SUPPORTED_MEDIA_TYPES = {
    "image/avif": ("AVIF", ".avif"),
    "image/gif": ("GIF", ".gif"),
    "image/jpeg": ("JPEG", ".jpg"),
    "image/png": ("PNG", ".png"),
    "image/webp": ("WEBP", ".webp"),
}


class InvalidImageError(ValueError):
    pass


class UnsupportedImageMediaTypeError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedImage:
    media_type: str
    extension: str
    width: int
    height: int


def validate_image(content: bytes, declared_media_type: str) -> ValidatedImage:
    expected = SUPPORTED_MEDIA_TYPES.get(declared_media_type.casefold())
    if expected is None:
        raise UnsupportedImageMediaTypeError
    try:
        with Image.open(BytesIO(content)) as image:
            detected_format = image.format
            width, height = image.size
            image.verify()
    except (OSError, SyntaxError, UnidentifiedImageError, ValueError) as error:
        raise InvalidImageError from error
    if detected_format != expected[0] or width < 1 or height < 1:
        raise InvalidImageError
    return ValidatedImage(declared_media_type.casefold(), expected[1], width, height)
