from pathlib import Path

from hoarder.fingerprints import fingerprint_media


def test_large_media_fingerprint_detects_changes_across_the_file(tmp_path: Path) -> None:
    media = tmp_path / "large.mp4"
    media.write_bytes(b"a" * (17 * 1024 * 1024))
    original = fingerprint_media(media)

    with media.open("r+b") as stream:
        stream.seek(media.stat().st_size // 2)
        stream.write(b"changed")

    assert fingerprint_media(media) != original
