import shutil
import subprocess
import time
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from hoarder.app import create_app
from hoarder.catalog import Catalog
from sqlalchemy import create_engine


pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="FFmpeg and FFprobe are required for music extraction tests",
)


def _make_video(path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=navy:s=160x90:d=1.2",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1.2",
            "-shortest",
            "-c:v",
            "libx264",
            "-c:a",
            "aac",
            str(path),
        ],
        check=True,
    )


def _app(tmp_path: Path, source: Path):
    return create_app(
        database_url=f"sqlite:///{tmp_path / 'catalog.db'}",
        storage_roots=[
            {"key": "archive", "label": "Archive", "path": str(source.parent)}
        ],
        derivative_root=tmp_path / "derivatives",
    )


def test_extracts_a_range_as_a_cataloged_track_with_source_lineage(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "concert.mp4"
    _make_video(source)

    with TestClient(_app(tmp_path, source)) as client:
        client.post("/api/scans")
        asset = client.get("/api/assets?media_type=video").json()["items"][0]

        response = client.post(
            f"/api/assets/{asset['id']}/audio-extractions",
            json={
                "title": "Opening Theme",
                "artist": "House Ensemble",
                "release": "Live Archive",
                "year": 2026,
                "track_number": 1,
                "genre": "Ambient",
                "tags": ["Live", "Reference"],
                "start_ms": 100,
                "end_ms": 900,
                "format": "m4a",
                "bitrate_kbps": 128,
            },
        )

        assert response.status_code == 202
        job = client.get("/api/jobs").json()["items"][0]
        assert job["kind"] == "audio_extraction"
        assert job["status"] == "completed"
        assert job["attempt_count"] == 1

        tracks = client.get("/api/music/tracks").json()
        assert tracks["total"] == 1
        track = tracks["items"][0]
        assert track["duration_ms"] == pytest.approx(800, abs=120)
        assert track["title"] == "Opening Theme"
        assert track["artist"]["name"] == "House Ensemble"
        assert track["release"]["title"] == "Live Archive"
        assert track["release"]["year"] == 2026
        assert track["track_number"] == 1
        assert track["genre"] == "Ambient"
        assert track["tags"] == ["live", "reference"]
        assert track["source_asset"]["id"] == asset["id"]
        assert track["source_asset"]["title"] == "concert"
        assert client.get(f"/api/assets/{asset['id']}").json()["id"] == asset["id"]
        assert track["start_ms"] == 100
        assert track["end_ms"] == 900
        assert track["format"] == "m4a"
        assert track["codec"] == "aac"
        assert track["size"] > 0
        assert track["stream_url"] == f"/api/music/tracks/{track['id']}/stream"
        assert track["artwork_url"] is None
        tagged_file = tmp_path / "derivatives" / track["relative_path"]
        embedded = json.loads(
            subprocess.run(
                [
                    "ffprobe", "-v", "error", "-show_entries", "format_tags",
                    "-of", "json", str(tagged_file),
                ],
                check=True,
                capture_output=True,
                text=True,
            ).stdout
        )["format"]["tags"]
        assert embedded["title"] == "Opening Theme"
        assert embedded["artist"] == "House Ensemble"
        assert embedded["album"] == "Live Archive"
        assert embedded["genre"] == "Ambient"

        stream = client.get(
            track["stream_url"], headers={"Range": "bytes=0-15"}
        )
        assert stream.status_code == 206
        assert len(stream.content) == 16
        assert stream.headers["accept-ranges"] == "bytes"
        assert source.exists()


def test_music_navigation_filters_and_edits_normalized_metadata(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "session.mp4"
    _make_video(source)

    with TestClient(_app(tmp_path, source)) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]
        client.post(
            f"/api/assets/{asset_id}/audio-extractions",
            json={"title": "First Cut", "artist": "  The Band  ", "tags": ["Jam"]},
        )
        track = client.get("/api/music/tracks").json()["items"][0]

        response = client.patch(
            f"/api/music/tracks/{track['id']}",
            json={
                "title": "Final Cut",
                "artist": "The Band",
                "release": "Sessions",
                "year": 2025,
                "track_number": 2,
                "genre": "Rock",
                "tags": ["Jam", "Featured", "jam"],
            },
        )

        assert response.status_code == 200
        edited = response.json()
        assert edited["title"] == "Final Cut"
        assert edited["artist"]["name"] == "The Band"
        assert edited["release"]["title"] == "Sessions"
        assert edited["tags"] == ["featured", "jam"]
        assert client.get("/api/music/tracks?q=final").json()["total"] == 1
        assert client.get("/api/music/tracks?artist=the%20band").json()["total"] == 1
        assert client.get("/api/music/tracks?release=sessions").json()["total"] == 1
        assert client.get("/api/music/tracks?tag=featured").json()["total"] == 1
        assert client.get(
            "/api/music/tracks?q=final&artist=the%20band&release=sessions&tag=featured"
        ).json()["total"] == 1

        artists = client.get("/api/music/artists").json()
        releases = client.get("/api/music/releases").json()
        assert artists["items"] == [
            {"id": edited["artist"]["id"], "name": "The Band", "track_count": 1}
        ]
        assert releases["items"] == [
            {
                "id": edited["release"]["id"],
                "title": "Sessions",
                "year": 2025,
                "artist": edited["artist"],
                "track_count": 1,
            }
        ]

        cleared = client.patch(
            f"/api/music/tracks/{track['id']}",
            json={"year": None, "track_number": None},
        )
        too_long_tag = client.patch(
            f"/api/music/tracks/{track['id']}", json={"tags": ["x" * 121]}
        )
        assert cleared.status_code == 200
        assert cleared.json()["release"]["year"] is None
        assert cleared.json()["track_number"] is None
        assert too_long_tag.status_code == 422


def test_duplicate_recipe_conflicts_and_deleting_a_track_only_removes_derivative(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "performance.mp4"
    _make_video(source)

    with TestClient(_app(tmp_path, source)) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]
        payload = {"title": "Performance", "start_ms": 0, "end_ms": 700}
        assert client.post(
            f"/api/assets/{asset_id}/audio-extractions", json=payload
        ).status_code == 202

        duplicate = client.post(
            f"/api/assets/{asset_id}/audio-extractions", json=payload
        )

        assert duplicate.status_code == 409
        track = client.get("/api/music/tracks").json()["items"][0]
        derivative_path = tmp_path / "derivatives" / track["relative_path"]
        assert derivative_path.is_file()

        deleted = client.delete(f"/api/music/tracks/{track['id']}")

        assert deleted.status_code == 204
        assert not derivative_path.exists()
        assert source.exists()
        assert client.get("/api/music/tracks").json()["total"] == 0


def test_failed_extraction_leaves_no_partial_output_and_can_be_retried(
    tmp_path: Path,
) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "broken.mp4"
    source.write_bytes(b"not a real video")
    app = _app(tmp_path, source)

    with TestClient(app) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]
        queued = client.post(
            f"/api/assets/{asset_id}/audio-extractions",
            json={"title": "Broken source"},
        )
        job_id = queued.json()["job_id"]
        failed = client.get("/api/jobs").json()["items"][0]

        assert queued.status_code == 202
        assert failed["status"] == "failed"
        assert failed["attempt_count"] == 1
        assert failed["result"]["stage"] == "extract"
        assert failed["result"]["retryable"] is True
        assert not list((tmp_path / "derivatives").rglob("*.part"))
        assert client.get("/api/music/tracks").json()["total"] == 0

        retried = client.post(f"/api/jobs/{job_id}/retry")
        assert retried.status_code == 202
        failed_again = client.get("/api/jobs").json()["items"][0]
        assert failed_again["status"] == "failed"
        assert failed_again["attempt_count"] == 2


def test_rejects_invalid_ranges_and_non_video_sources(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "cover.jpg"
    source.write_bytes(b"image")

    with TestClient(_app(tmp_path, source)) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]
        wrong_type = client.post(
            f"/api/assets/{asset_id}/audio-extractions", json={"title": "Nope"}
        )
        invalid_range = client.post(
            f"/api/assets/{asset_id}/audio-extractions",
            json={"title": "Nope", "start_ms": 1000, "end_ms": 1000},
        )

        assert wrong_type.status_code == 409
        assert invalid_range.status_code == 422


def test_queued_audio_work_resumes_after_an_api_restart(tmp_path: Path) -> None:
    media = tmp_path / "media"
    media.mkdir()
    source = media / "restart-session.mp4"
    _make_video(source)
    database_url = f"sqlite:///{tmp_path / 'catalog.db'}"
    roots = [{"key": "archive", "label": "Archive", "path": str(media)}]
    derivative_root = tmp_path / "derivatives"

    first_app = create_app(
        database_url=database_url,
        storage_roots=roots,
        derivative_root=derivative_root,
    )
    with TestClient(first_app) as client:
        client.post("/api/scans")
        asset_id = client.get("/api/assets").json()["items"][0]["id"]

    engine = create_engine(database_url)
    catalog = Catalog(engine, roots, derivative_root)
    catalog.initialize()
    job_id, error = catalog.queue_audio_extraction(
        asset_id, {"title": "Restart proof", "format": "m4a", "bitrate_kbps": 128}
    )
    engine.dispose()
    assert error is None

    restarted_app = create_app(
        database_url=database_url,
        storage_roots=roots,
        derivative_root=derivative_root,
    )
    with TestClient(restarted_app) as client:
        deadline = time.monotonic() + 5
        job = None
        while time.monotonic() < deadline:
            job = next(
                item for item in client.get("/api/jobs").json()["items"]
                if item["id"] == job_id
            )
            if job["status"] == "completed":
                break
            time.sleep(0.05)

        assert job is not None
        assert job["status"] == "completed"
        assert client.get("/api/music/tracks").json()["total"] == 1
