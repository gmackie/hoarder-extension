from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def _scanned_client(tmp_path: Path) -> tuple[TestClient, str]:
    media = tmp_path / "media"
    media.mkdir()
    (media / "Museum Tour.mp4").write_bytes(b"museum-video")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )
    client = TestClient(app)
    client.__enter__()
    client.post("/api/scans")
    asset_id = client.get("/api/assets").json()["items"][0]["id"]
    return client, asset_id


def test_asset_editorial_state_is_normalized_and_survives_rescans(
    tmp_path: Path,
) -> None:
    client, asset_id = _scanned_client(tmp_path)
    try:
        response = client.patch(
            f"/api/assets/{asset_id}/editorial",
            json={
                "rating": 4,
                "favorite": True,
                "workflow_state": "candidate",
                "notes": "Strong archival and production detail.",
                "tags": ["Infrastructure", "museum", " infrastructure "],
            },
        )

        assert response.status_code == 200
        assert response.json() == {
            "asset_id": asset_id,
            "rating": 4,
            "favorite": True,
            "workflow_state": "candidate",
            "notes": "Strong archival and production detail.",
            "tags": ["infrastructure", "museum"],
        }

        moved_directory = tmp_path / "media" / "reviewed"
        moved_directory.mkdir()
        (tmp_path / "media" / "Museum Tour.mp4").rename(
            moved_directory / "Museum Tour renamed.mp4"
        )
        client.post("/api/scans")

        persisted = client.get(f"/api/assets/{asset_id}/editorial")
        assert persisted.status_code == 200
        assert persisted.json() == response.json()
        assets = client.get("/api/assets").json()["items"]
        assert [asset["id"] for asset in assets] == [asset_id]
        assert assets[0]["files"][0]["relative_path"] == (
            "reviewed/Museum Tour renamed.mp4"
        )
    finally:
        client.__exit__(None, None, None)


def test_assets_can_be_filtered_by_editorial_state(tmp_path: Path) -> None:
    client, asset_id = _scanned_client(tmp_path)
    try:
        client.patch(
            f"/api/assets/{asset_id}/editorial",
            json={
                "favorite": True,
                "workflow_state": "reviewed",
                "tags": ["history"],
            },
        )

        response = client.get(
            "/api/assets",
            params={"favorite": True, "workflow_state": "reviewed", "tag": "HISTORY"},
        )

        assert response.status_code == 200
        assert response.json()["total"] == 1
        assert response.json()["items"][0]["id"] == asset_id
        assert response.json()["items"][0]["editorial"]["favorite"] is True
    finally:
        client.__exit__(None, None, None)


def test_editorial_updates_validate_rating_workflow_and_asset_identity(
    tmp_path: Path,
) -> None:
    client, asset_id = _scanned_client(tmp_path)
    try:
        assert client.patch(
            f"/api/assets/{asset_id}/editorial", json={"rating": 6}
        ).status_code == 422
        assert client.patch(
            f"/api/assets/{asset_id}/editorial",
            json={"workflow_state": "invented"},
        ).status_code == 422
        assert client.patch(
            f"/api/assets/{asset_id}/editorial", json={"favorite": None}
        ).status_code == 422
        assert client.patch(
            f"/api/assets/{asset_id}/editorial", json={"workflow_state": None}
        ).status_code == 422
        client.patch(
            f"/api/assets/{asset_id}/editorial", json={"tags": ["temporary"]}
        )
        cleared_tags = client.patch(
            f"/api/assets/{asset_id}/editorial", json={"tags": None}
        )
        assert cleared_tags.status_code == 200
        assert cleared_tags.json()["tags"] == []
        assert client.patch(
            "/api/assets/missing/editorial", json={"favorite": True}
        ).status_code == 404
    finally:
        client.__exit__(None, None, None)
