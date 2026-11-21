from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_assets_can_be_filtered_by_media_type_and_search_text(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Museum Tour.mp4").write_bytes(b"museum-video")
    (media / "Museum Poster.jpg").write_bytes(b"museum-image")
    (media / "Other Clip.mp4").write_bytes(b"other-video")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")

        response = client.get(
            "/api/assets", params={"media_type": "video", "q": "museum"}
        )

        assert response.status_code == 200
        assert response.json()["total"] == 1
        assert response.json()["items"][0]["title"] == "Museum Tour"


def test_assets_are_paginated_without_losing_the_filtered_total(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    for name in ("one.mp4", "two.mp4", "three.mp4"):
        (media / name).write_bytes(name.encode())
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")

        response = client.get("/api/assets", params={"limit": 1, "offset": 1})

        assert response.status_code == 200
        assert response.json()["total"] == 3
        assert len(response.json()["items"]) == 1
