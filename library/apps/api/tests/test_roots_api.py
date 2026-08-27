from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_storage_root_health_is_visible_to_clients(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "primary", "label": "Primary", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")

        roots = client.get("/api/roots").json()["items"]
        assert roots == [
            {
                "key": "primary",
                "label": "Primary",
                "health": "online",
            }
        ]


def test_missing_root_sentinel_prevents_scanning_the_wrong_mount(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "clip.mp4").write_bytes(b"video")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[
            {
                "key": "primary",
                "label": "Primary",
                "path": str(media),
                "sentinel": ".hoarder-root",
            }
        ],
    )

    with TestClient(app) as client:
        scan = client.post("/api/scans").json()

        assert scan["discovered"] == 0
        assert client.get("/api/roots").json()["items"][0]["health"] == "degraded"
