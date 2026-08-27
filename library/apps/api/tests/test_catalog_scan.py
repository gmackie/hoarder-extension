from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_scan_discovers_supported_media_in_a_configured_root(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "clip.mp4").write_bytes(b"video-data")
    (media / "song.flac").write_bytes(b"audio-data")
    (media / "poster.jpg").write_bytes(b"image-data")
    (media / "notes.txt").write_text("not media")

    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        response = client.post("/api/scans")

        assert response.status_code == 200
        assert response.json()["discovered"] == 3

        assets = client.get("/api/assets").json()["items"]
        assert {(asset["title"], asset["media_type"]) for asset in assets} == {
            ("clip", "video"),
            ("song", "audio"),
            ("poster", "image"),
        }


def test_scan_preserves_asset_identity_when_a_file_moves(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    original = media / "unreviewed" / "clip.mp4"
    original.parent.mkdir()
    original.write_bytes(b"same-video-content")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        original_asset = client.get("/api/assets").json()["items"][0]

        moved = media / "reviewed" / "renamed.mp4"
        moved.parent.mkdir()
        original.rename(moved)
        client.post("/api/scans")

        assets = client.get("/api/assets").json()["items"]
        assert len(assets) == 1
        assert assets[0]["id"] == original_asset["id"]
        assert assets[0]["files"][0]["relative_path"] == "reviewed/renamed.mp4"


def test_scan_marks_an_asset_missing_after_an_online_file_disappears(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    video = media / "clip.mp4"
    video.write_bytes(b"video-content")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        video.unlink()

        client.post("/api/scans")

        assert client.get("/api/assets").json()["items"][0]["status"] == "missing"


def test_scan_keeps_assets_available_when_their_storage_root_is_offline(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "clip.mp4").write_bytes(b"video-content")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        media.rename(tmp_path / "disconnected-media")

        client.post("/api/scans")

        assert client.get("/api/assets").json()["items"][0]["status"] == "available"


def test_scan_links_duplicate_physical_copies_to_one_asset(tmp_path: Path) -> None:
    primary = tmp_path / "primary"
    secondary = tmp_path / "secondary"
    primary.mkdir()
    secondary.mkdir()
    (primary / "original.mp4").write_bytes(b"shared-content")
    (secondary / "backup.mp4").write_bytes(b"shared-content")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[
            {"key": "primary", "label": "Primary", "path": str(primary)},
            {"key": "secondary", "label": "Secondary", "path": str(secondary)},
        ],
    )

    with TestClient(app) as client:
        client.post("/api/scans")

        assets = client.get("/api/assets").json()["items"]
        assert len(assets) == 1
        assert {file["relative_path"] for file in assets[0]["files"]} == {
            "original.mp4",
            "backup.mp4",
        }


def test_scan_restores_availability_when_a_missing_file_reappears(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    video = media / "clip.mp4"
    video.write_bytes(b"video-content")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "primary", "label": "Primary", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        video.unlink()
        client.post("/api/scans")
        video.write_bytes(b"video-content")

        client.post("/api/scans")

        assert client.get("/api/assets").json()["items"][0]["status"] == "available"


def test_scan_keeps_a_duplicate_asset_available_while_one_copy_is_online(
    tmp_path: Path,
) -> None:
    primary = tmp_path / "primary"
    secondary = tmp_path / "secondary"
    primary.mkdir()
    secondary.mkdir()
    first_copy = primary / "first.mp4"
    first_copy.write_bytes(b"shared-content")
    (secondary / "second.mp4").write_bytes(b"shared-content")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[
            {"key": "primary", "label": "Primary", "path": str(primary)},
            {"key": "secondary", "label": "Secondary", "path": str(secondary)},
        ],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        first_copy.unlink()

        client.post("/api/scans")

        assert client.get("/api/assets").json()["items"][0]["status"] == "available"


def test_scan_refreshes_file_metadata_when_content_changes_in_place(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    video = media / "clip.mp4"
    video.write_bytes(b"short")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "primary", "label": "Primary", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]
        video.write_bytes(b"replacement-content")

        client.post("/api/scans")

        asset = client.get("/api/assets").json()["items"][0]
        assert asset["id"] == asset_id
        assert asset["files"][0]["size"] == len(b"replacement-content")
