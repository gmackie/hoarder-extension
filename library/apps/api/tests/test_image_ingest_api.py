import base64
from pathlib import Path

from fastapi.testclient import TestClient
from hoarder.app import create_app


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def build_app(tmp_path: Path, *, max_bytes: int = 25 * 1024 * 1024):
    archive = tmp_path / "archive"
    archive.mkdir()
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[
            {"key": "archive", "label": "Archive", "path": str(archive)},
            {
                "key": "saved-images",
                "label": "Saved images",
                "path": str(uploads),
                "writable": True,
                "accepts_images": True,
            },
        ],
        image_upload_max_bytes=max_bytes,
    )
    return app, uploads


def upload(client: TestClient, *, content: bytes = PNG, content_type: str = "image/png"):
    return client.post(
        "/upload",
        files={"image": ("museum.png", content, content_type)},
        data={
            "destination": "saved-images",
            "source_url": "https://images.example.test/museum.png",
            "page_url": "https://example.test/exhibits/museum",
            "page_title": "Museum exhibit",
            "tags": "history, Reference, history",
        },
    )


def test_destinations_expose_only_configured_image_upload_roots(tmp_path: Path) -> None:
    app, _ = build_app(tmp_path)

    with TestClient(app) as client:
        response = client.get("/destinations")

    assert response.status_code == 200
    assert response.json() == {
        "destinations": [
            {"id": "saved-images", "label": "Saved images", "available": True}
        ]
    }


def test_valid_image_is_atomically_saved_and_cataloged_with_provenance(
    tmp_path: Path,
) -> None:
    app, uploads = build_app(tmp_path)

    with TestClient(app) as client:
        response = upload(client)
        asset = client.get(f"/api/assets/{response.json()['asset_id']}").json()
        inbox = client.get(
            "/api/assets", params={"media_type": "image", "q": "museum"}
        ).json()

    assert response.status_code == 201
    assert response.json()["status"] == "saved"
    assert response.json()["destination"] == "saved-images"
    assert response.json()["asset_url"] == f"/api/assets/{response.json()['asset_id']}"
    assert asset["media_type"] == "image"
    assert asset["editorial"]["workflow_state"] == "inbox"
    assert asset["editorial"]["tags"] == ["history", "reference"]
    assert asset["origins"] == [
        {
            "source_url": "https://images.example.test/museum.png",
            "page_url": "https://example.test/exhibits/museum",
            "page_title": "Museum exhibit",
            "original_filename": "museum.png",
            "destination": "saved-images",
            "captured_at": asset["origins"][0]["captured_at"],
        }
    ]
    assert inbox["total"] == 1
    saved_files = [path for path in uploads.rglob("*") if path.is_file()]
    assert len(saved_files) == 1
    assert saved_files[0].read_bytes() == PNG
    assert not list(uploads.rglob("*.part"))


def test_single_image_destination_remains_compatible_when_key_is_omitted(
    tmp_path: Path,
) -> None:
    app, _ = build_app(tmp_path)

    with TestClient(app) as client:
        response = client.post(
            "/upload",
            files={"image": ("museum.png", PNG, "image/png")},
        )

    assert response.status_code == 201
    assert response.json()["destination"] == "saved-images"


def test_duplicate_upload_reuses_asset_and_records_new_source_page(tmp_path: Path) -> None:
    app, uploads = build_app(tmp_path)

    with TestClient(app) as client:
        first = upload(client)
        duplicate = client.post(
            "/upload",
            files={"image": ("second-name.png", PNG, "image/png")},
            data={
                "destination": "saved-images",
                "source_url": "https://cdn.example.test/same-image.png",
                "page_url": "https://example.test/another-page",
                "page_title": "Another page",
            },
        )
        asset = client.get(f"/api/assets/{first.json()['asset_id']}").json()

    assert duplicate.status_code == 200
    assert duplicate.json()["status"] == "duplicate"
    assert duplicate.json()["asset_id"] == first.json()["asset_id"]
    assert len(asset["origins"]) == 2
    assert len([path for path in uploads.rglob("*") if path.is_file()]) == 1


def test_upload_rejects_spoofed_or_undecodable_content(tmp_path: Path) -> None:
    app, uploads = build_app(tmp_path)

    with TestClient(app) as client:
        spoofed = upload(client, content_type="application/pdf")
        undecodable = upload(client, content=b"not actually a png")

    assert spoofed.status_code == 415
    assert spoofed.json()["detail"] == "Unsupported image media type"
    assert undecodable.status_code == 422
    assert undecodable.json()["detail"] == "Uploaded content is not a valid image"
    assert not [path for path in uploads.rglob("*") if path.is_file()]


def test_upload_rejects_oversized_content_without_partial_files(tmp_path: Path) -> None:
    app, uploads = build_app(tmp_path, max_bytes=len(PNG) - 1)

    with TestClient(app) as client:
        response = upload(client)

    assert response.status_code == 413
    assert response.json()["detail"] == "Image exceeds the configured size limit"
    assert not list(uploads.rglob("*.part"))


def test_upload_reports_unknown_and_offline_destinations_explicitly(
    tmp_path: Path,
) -> None:
    app, uploads = build_app(tmp_path)
    uploads.rmdir()

    with TestClient(app) as client:
        destinations = client.get("/destinations")
        offline = upload(client)
        unknown = client.post(
            "/upload",
            files={"image": ("museum.png", PNG, "image/png")},
            data={"destination": "not-configured"},
        )

    assert destinations.json()["destinations"][0]["available"] is False
    assert offline.status_code == 503
    assert offline.json()["detail"] == "Image destination is unavailable"
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "Image destination was not found"
