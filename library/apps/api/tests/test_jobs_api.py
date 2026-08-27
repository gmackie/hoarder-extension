from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_scan_is_visible_as_a_completed_job(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "clip.mp4").write_bytes(b"video")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        scan = client.post("/api/scans").json()

        jobs = client.get("/api/jobs").json()["items"]
        assert jobs[0]["id"] == scan["job_id"]
        assert jobs[0]["kind"] == "storage_scan"
        assert jobs[0]["status"] == "completed"
        assert jobs[0]["result"]["discovered"] == 1
