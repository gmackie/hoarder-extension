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
                    "writable": True,
                    "accepts_images": True,
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
    assert settings.storage_roots[0].writable is False
    assert settings.storage_roots[0].accepts_images is False
    assert settings.storage_roots[1].writable is True
    assert settings.storage_roots[1].accepts_images is True
    assert settings.storage_roots[1].exclude_patterns == ["cache/**", "*.partial"]
    assert settings.storage_roots[1].thumbnail_patterns == [
        "cache/videos/{first}/{stem}.jpg"
    ]
    assert settings.storage_roots[1].channel_path_prefixes == ["youtube"]
    assert settings.storage_roots[1].channel_metadata_path == "metadata/channels.json"
    assert settings.storage_roots[1].channel_thumbnail_patterns == [
        "cache/channels/{channel_id}_thumb.jpg"
    ]


def test_derivative_storage_is_configurable_without_changing_media_roots(
    monkeypatch,
) -> None:
    monkeypatch.setenv("HOARDER_DERIVATIVE_ROOT", "/data/generated-media")

    settings = Settings()

    assert settings.derivative_root == "/data/generated-media"


def test_image_upload_limit_is_configurable(monkeypatch) -> None:
    monkeypatch.setenv("HOARDER_IMAGE_UPLOAD_MAX_BYTES", "1048576")

    settings = Settings()

    assert settings.image_upload_max_bytes == 1_048_576
