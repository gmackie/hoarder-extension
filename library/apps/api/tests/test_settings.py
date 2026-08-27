import json

from hoarder.settings import Settings


def test_storage_roots_are_loaded_from_portable_environment_configuration(
    monkeypatch,
) -> None:
    monkeypatch.setenv(
        "HOARDER_STORAGE_ROOTS",
        json.dumps(
            [
                {"key": "primary", "label": "Primary archive", "path": "/media/a"},
                {
                    "key": "backup",
                    "label": "Backup archive",
                    "path": "/media/b",
                    "exclude_patterns": ["cache/**", "*.partial"],
                    "thumbnail_patterns": [
                        "cache/videos/{first}/{stem}.jpg",
                    ],
                    "channel_path_prefixes": ["youtube"],
                    "channel_metadata_path": "metadata/channels.json",
                    "channel_thumbnail_patterns": [
                        "cache/channels/{channel_id}_thumb.jpg",
                    ],
                },
            ]
        ),
    )

    settings = Settings()

    assert [root.key for root in settings.storage_roots] == ["primary", "backup"]
    assert settings.storage_roots[1].path == "/media/b"
    assert settings.storage_roots[1].exclude_patterns == ["cache/**", "*.partial"]
    assert settings.storage_roots[1].thumbnail_patterns == [
        "cache/videos/{first}/{stem}.jpg"
    ]
    assert settings.storage_roots[1].channel_path_prefixes == ["youtube"]
    assert settings.storage_roots[1].channel_metadata_path == "metadata/channels.json"
    assert settings.storage_roots[1].channel_thumbnail_patterns == [
        "cache/channels/{channel_id}_thumb.jpg"
    ]
