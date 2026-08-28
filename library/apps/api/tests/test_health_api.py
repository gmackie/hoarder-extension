from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_health_reports_database_and_storage_summary(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "primary", "label": "Primary", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")

        response = client.get("/api/health")

        assert response.status_code == 200
        assert response.json() == {
            "status": "ok",
            "database": "ok",
            "roots": {"online": 1, "degraded": 0, "offline": 0, "unknown": 0},
        }
