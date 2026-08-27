import json
from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


def test_source_channels_group_assets_with_names_artwork_and_counts(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    first_channel = media / "youtube" / "UC-one"
    second_channel = media / "youtube" / "UC-two"
    artwork = media / "youtube-cache" / "channels"
    metadata = media / "hoarder-metadata"
    first_channel.mkdir(parents=True)
    second_channel.mkdir(parents=True)
    artwork.mkdir(parents=True)
    metadata.mkdir(parents=True)
    (first_channel / "video-a.mp4").write_bytes(b"video-a")
    (first_channel / "video-b.mp4").write_bytes(b"video-b")
    (second_channel / "video-c.mp4").write_bytes(b"video-c")
    (artwork / "UC-one_thumb.jpg").write_bytes(b"channel-artwork")
    (metadata / "channels.json").write_text(
        json.dumps(
            {
                "channels": {
                    "UC-one": {"title": "First Source", "subscribers": 1200},
                    "UC-two": {"title": "Second Source", "subscribers": 800},
                }
            }
        )
    )
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[
            {
                "key": "archive",
                "label": "Archive",
                "path": str(media),
                "exclude_patterns": ["youtube-cache/**"],
                "channel_path_prefixes": ["youtube"],
                "channel_metadata_path": "hoarder-metadata/channels.json",
                "channel_thumbnail_patterns": [
                    "youtube-cache/channels/{channel_id}_thumb.jpg"
                ],
            }
        ],
    )

    with TestClient(app) as client:
        client.post("/api/scans")

        response = client.get("/api/channels")

        assert response.status_code == 200
        assert response.json()["total"] == 2
        channels = response.json()["items"]
        assert [(channel["title"], channel["video_count"]) for channel in channels] == [
            ("First Source", 2),
            ("Second Source", 1),
        ]
        first = channels[0]
        assert first["id"] == "UC-one"
        assert first["thumbnail_url"] == "/api/channels/UC-one/thumbnail"
        assert first["subscribers"] == 1200

        thumbnail = client.get(first["thumbnail_url"])
        assert thumbnail.status_code == 200
        assert thumbnail.content == b"channel-artwork"

        assets = client.get("/api/channels/UC-one/assets?media_type=video")
        assert assets.status_code == 200
        assert assets.json()["total"] == 2
        assert {asset["title"] for asset in assets.json()["items"]} == {
            "video-a",
            "video-b",
        }

        search = client.get("/api/channels?q=second")
        assert [channel["id"] for channel in search.json()["items"]] == ["UC-two"]
