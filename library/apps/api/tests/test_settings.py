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
