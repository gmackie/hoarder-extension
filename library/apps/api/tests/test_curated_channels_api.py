from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_curated_channels_manage_ordered_asset_membership(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    (media / "First.mp4").write_bytes(b"first")
    (media / "Second.mp4").write_bytes(b"second")
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        client.post("/api/scans")
        assets = client.get("/api/assets").json()["items"]
        asset_ids = {asset["title"]: asset["id"] for asset in assets}

        created = client.post(
            "/api/curated-channels",
            json={"name": "Museum Television", "description": "Always-on candidates"},
        )
        assert created.status_code == 201
        channel = created.json()
        assert channel["name"] == "Museum Television"
        assert channel["item_count"] == 0

        first = client.post(
            f"/api/curated-channels/{channel['id']}/items",
            json={"asset_id": asset_ids["First"], "status": "candidate"},
        )
        second = client.post(
            f"/api/curated-channels/{channel['id']}/items",
            json={"asset_id": asset_ids["Second"], "status": "reviewed"},
        )
        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["position"] == 0
        assert second.json()["position"] == 1

        duplicate = client.post(
            f"/api/curated-channels/{channel['id']}/items",
            json={"asset_id": asset_ids["First"]},
        )
        assert duplicate.status_code == 409

        reordered = client.patch(
            f"/api/curated-channels/{channel['id']}/items/{asset_ids['Second']}",
            json={"position": 0, "status": "selected"},
        )
        assert reordered.status_code == 200
        assert reordered.json()["position"] == 0
        assert reordered.json()["status"] == "selected"

        listing = client.get(f"/api/curated-channels/{channel['id']}/items")
        assert listing.status_code == 200
        assert listing.json()["total"] == 2
        assert [item["asset"]["title"] for item in listing.json()["items"]] == [
            "Second",
            "First",
        ]
        assert [item["position"] for item in listing.json()["items"]] == [0, 1]

        (media / "Second.mp4").rename(media / "Second renamed.mp4")
        client.post("/api/scans")
        persisted_membership = client.get(
            f"/api/curated-channels/{channel['id']}/items"
        )
        assert [item["asset_id"] for item in persisted_membership.json()["items"]] == [
            asset_ids["Second"],
            asset_ids["First"],
        ]

        channels = client.get("/api/curated-channels")
        assert channels.status_code == 200
        assert channels.json()["items"][0]["item_count"] == 2

        removed = client.delete(
            f"/api/curated-channels/{channel['id']}/items/{asset_ids['First']}"
        )
        assert removed.status_code == 204
        remaining = client.get(f"/api/curated-channels/{channel['id']}/items")
        assert remaining.json()["total"] == 1
        assert remaining.json()["items"][0]["position"] == 0


def test_curated_channels_validate_resources_and_support_editing(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        created = client.post("/api/curated-channels", json={"name": "Initial"})
        channel_id = created.json()["id"]

        updated = client.patch(
            f"/api/curated-channels/{channel_id}",
            json={"name": "Finished", "description": "Ready to program"},
        )
        assert updated.status_code == 200
        assert updated.json()["name"] == "Finished"

        assert client.patch(
            f"/api/curated-channels/{channel_id}", json={"name": None}
        ).status_code == 422

        assert client.post(
            f"/api/curated-channels/{channel_id}/items",
            json={"asset_id": "missing"},
        ).status_code == 404
        assert client.get("/api/curated-channels/missing/items").status_code == 404

        assert client.patch(
            f"/api/curated-channels/{channel_id}/items/missing",
            json={"position": None},
        ).status_code == 422
        assert client.patch(
            f"/api/curated-channels/{channel_id}/items/missing",
            json={"status": None},
        ).status_code == 422

        deleted = client.delete(f"/api/curated-channels/{channel_id}")
        assert deleted.status_code == 204
        assert client.get(f"/api/curated-channels/{channel_id}").status_code == 404
