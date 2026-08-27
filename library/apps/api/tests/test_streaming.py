from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_asset_stream_supports_http_byte_ranges(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "clip.mp4").write_bytes(b"0123456789")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]

        response = client.get(
            f"/api/assets/{asset_id}/stream", headers={"Range": "bytes=2-5"}
        )

        assert response.status_code == 206
        assert response.content == b"2345"
        assert response.headers["content-range"] == "bytes 2-5/10"
        assert response.headers["accept-ranges"] == "bytes"


def test_asset_stream_uses_an_available_duplicate_location(tmp_path: Path) -> None:
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
        asset_id = client.get("/api/assets").json()["items"][0]["id"]
        first_copy.unlink()
        client.post("/api/scans")

        response = client.get(f"/api/assets/{asset_id}/stream")

        assert response.status_code == 200
        assert response.content == b"shared-content"
