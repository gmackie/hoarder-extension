from hashlib import sha256
from pathlib import Path

FULL_HASH_LIMIT = 16 * 1024 * 1024
SAMPLE_SIZE = 1024 * 1024


def fingerprint_media(path: Path) -> str:
    size = path.stat().st_size
    digest = sha256()
    digest.update(size.to_bytes(8, byteorder="big", signed=False))

    with path.open("rb") as stream:
        if size <= FULL_HASH_LIMIT:
            for chunk in iter(lambda: stream.read(SAMPLE_SIZE), b""):
                digest.update(chunk)
            return digest.hexdigest()

        offsets = (0, max((size - SAMPLE_SIZE) // 2, 0), size - SAMPLE_SIZE)
        for offset in offsets:
            digest.update(offset.to_bytes(8, byteorder="big", signed=False))
            stream.seek(offset)
            digest.update(stream.read(SAMPLE_SIZE))
    return digest.hexdigest()
