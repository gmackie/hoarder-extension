from pathlib import Path

from fastapi.testclient import TestClient

from hoarder.app import create_app


def _create_programmed_channel(client: TestClient, media: Path) -> tuple[str, dict[str, str]]:
    for name, content in (
        ("First Film.mp4", b"first"),
        ("Second Film.mp4", b"second"),
        ("Holding Slide.png", b"image"),
    ):
        (media / name).write_bytes(content)
    client.post("/api/scans")
    assets = client.get("/api/assets", params={"limit": 20}).json()["items"]
    asset_ids = {asset["title"]: asset["id"] for asset in assets}
    channel = client.post(
        "/api/curated-channels",
        json={"name": "Museum Television", "description": "Living-room loop"},
    ).json()
    for title, item_status in (
        ("First Film", "selected"),
        ("Second Film", "selected"),
        ("Holding Slide", "candidate"),
    ):
        response = client.post(
            f"/api/curated-channels/{channel['id']}/items",
            json={"asset_id": asset_ids[title], "status": item_status},
        )
        assert response.status_code == 201
    return channel["id"], asset_ids


def test_playout_session_resumes_and_advances_without_mutating_editorial_order(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        channel_id, asset_ids = _create_programmed_channel(client, media)
        configured = client.put(
            f"/api/curated-channels/{channel_id}/playout",
            json={
                "enabled": True,
                "playback_mode": "ordered",
                "loop": True,
                "image_duration_seconds": 12,
                "item_statuses": ["selected"],
            },
        )
        assert configured.status_code == 200
        assert configured.json()["eligible_item_count"] == 2
        assert configured.json()["image_duration_seconds"] == 12

        started = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "living-room"},
        )
        assert started.status_code == 201
        session = started.json()
        assert session["screen_key"] == "living-room"
        assert session["paused"] is True
        assert session["current"]["asset"]["title"] == "First Film"
        assert session["next"]["asset"]["title"] == "Second Film"
        assert session["current"]["stream_url"].endswith(
            f"/api/assets/{asset_ids['First Film']}/stream"
        )

        heartbeat = client.patch(
            f"/api/playout-sessions/{session['id']}",
            json={
                "expected_asset_id": asset_ids["First Film"],
                "position_ms": 12_500,
                "paused": False,
            },
        )
        assert heartbeat.status_code == 200
        assert heartbeat.json()["position_ms"] == 12_500

        resumed = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "living-room"},
        )
        assert resumed.status_code == 200
        assert resumed.json()["id"] == session["id"]
        assert resumed.json()["position_ms"] == 12_500

        advanced = client.post(
            f"/api/playout-sessions/{session['id']}/advance",
            json={"expected_asset_id": asset_ids["First Film"]},
        )
        assert advanced.status_code == 200
        assert advanced.json()["current"]["asset"]["title"] == "Second Film"
        assert advanced.json()["position_ms"] == 0

        looped = client.post(
            f"/api/playout-sessions/{session['id']}/advance",
            json={"expected_asset_id": asset_ids["Second Film"]},
        )
        assert looped.status_code == 200
        assert looped.json()["current"]["asset"]["title"] == "First Film"
        assert looped.json()["cycle"] == 1

        items = client.get(f"/api/curated-channels/{channel_id}/items").json()["items"]
        assert [item["status"] for item in items] == ["selected", "selected", "candidate"]
        assert [item["position"] for item in items] == [0, 1, 2]


def test_playout_is_deterministic_and_rejects_stale_screen_updates(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    database_url = f"sqlite:///{tmp_path / 'catalog.db'}"
    roots = [{"key": "archive", "label": "Archive", "path": str(media)}]
    app = create_app(database_url=database_url, storage_roots=roots)

    with TestClient(app) as client:
        channel_id, asset_ids = _create_programmed_channel(client, media)
        configured = client.put(
            f"/api/curated-channels/{channel_id}/playout",
            json={
                "enabled": True,
                "playback_mode": "shuffle",
                "loop": True,
                "image_duration_seconds": 15,
                "item_statuses": ["selected", "candidate"],
            },
        )
        assert configured.status_code == 200
        session = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "kitchen"},
        ).json()
        first_asset_id = session["current"]["asset"]["id"]

        stale = client.post(
            f"/api/playout-sessions/{session['id']}/advance",
            json={"expected_asset_id": asset_ids["First Film"] if first_asset_id != asset_ids["First Film"] else asset_ids["Second Film"]},
        )
        assert stale.status_code == 409
        assert stale.json()["detail"] == "Screen state is stale; refresh the session"

    restarted = create_app(database_url=database_url, storage_roots=roots)
    with TestClient(restarted) as client:
        resumed = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "kitchen"},
        )
        assert resumed.status_code == 200
        assert resumed.json()["id"] == session["id"]
        assert resumed.json()["current"]["asset"]["id"] == first_asset_id


def test_playout_requires_an_enabled_channel_with_eligible_online_media(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        channel_id, _ = _create_programmed_channel(client, media)
        disabled = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "office"},
        )
        assert disabled.status_code == 409
        assert disabled.json()["detail"] == "Channel playout is disabled"

        configured = client.put(
            f"/api/curated-channels/{channel_id}/playout",
            json={
                "enabled": True,
                "playback_mode": "ordered",
                "loop": False,
                "image_duration_seconds": 15,
                "item_statuses": ["used"],
            },
        )
        assert configured.status_code == 200
        assert configured.json()["eligible_item_count"] == 0
        empty = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "office"},
        )
        assert empty.status_code == 409
        assert empty.json()["detail"] == "Channel has no eligible online media"

        invalid_statuses = client.put(
            f"/api/curated-channels/{channel_id}/playout",
            json={
                "enabled": True,
                "playback_mode": "ordered",
                "loop": True,
                "image_duration_seconds": 15,
                "item_statuses": [],
            },
        )
        assert invalid_statuses.status_code == 422


def test_playout_dashboard_summarizes_readiness_and_durable_screens(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        channel_id, _ = _create_programmed_channel(client, media)
        client.put(
            f"/api/curated-channels/{channel_id}/playout",
            json={
                "enabled": True,
                "playback_mode": "ordered",
                "loop": True,
                "image_duration_seconds": 15,
                "item_statuses": ["selected"],
            },
        )
        started = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "living-room"},
        ).json()

        response = client.get("/api/playout/channels")

        assert response.status_code == 200
        assert response.json()["total"] == 1
        summary = response.json()["items"][0]
        assert summary["channel"]["name"] == "Museum Television"
        assert summary["configuration"]["eligible_item_count"] == 2
        assert summary["ready"] is True
        assert summary["active_screen_count"] == 1
        assert summary["sessions"][0]["id"] == started["id"]
        assert summary["sessions"][0]["current_title"] == "First Film"


def test_playout_does_not_schedule_assets_when_their_storage_root_is_offline(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[{"key": "archive", "label": "Archive", "path": str(media)}],
    )

    with TestClient(app) as client:
        channel_id, _ = _create_programmed_channel(client, media)
        client.put(
            f"/api/curated-channels/{channel_id}/playout",
            json={
                "enabled": True,
                "playback_mode": "ordered",
                "loop": True,
                "image_duration_seconds": 15,
                "item_statuses": ["selected"],
            },
        )
        media.rename(tmp_path / "offline-media")
        client.post("/api/scans")

        configuration = client.get(
            f"/api/curated-channels/{channel_id}/playout"
        ).json()
        assert configuration["eligible_item_count"] == 0
        response = client.post(
            f"/api/curated-channels/{channel_id}/playout-sessions",
            json={"screen_key": "offline-proof"},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "Channel has no eligible online media"
