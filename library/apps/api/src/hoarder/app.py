import mimetypes
import asyncio
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlparse

from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import create_engine

from .catalog import Catalog
from .image_ingest import (
    InvalidImageError,
    UnsupportedImageMediaTypeError,
    validate_image,
)

WorkflowState = Literal["inbox", "candidate", "reviewed", "selected", "archived"]
ChannelItemStatus = Literal["candidate", "reviewed", "selected", "used", "rejected"]
AudioFormat = Literal["m4a", "opus", "flac"]


class EditorialPatch(BaseModel):
    rating: int | None = Field(default=None, ge=1, le=5)
    favorite: bool | None = None
    workflow_state: WorkflowState | None = None
    notes: str | None = Field(default=None, max_length=20_000)
    tags: list[str] | None = Field(default=None, max_length=50)

    @field_validator("favorite", "workflow_state", mode="before")
    @classmethod
    def reject_null_required_updates(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("This field cannot be null")
        return value

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, tags: list[str] | None) -> list[str] | None:
        if tags is not None and any(len(tag.strip()) > 120 for tag in tags):
            raise ValueError("Tags must be 120 characters or fewer")
        return tags


class CuratedChannelCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20_000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        if not name.strip():
            raise ValueError("Channel name cannot be blank")
        return name


class CuratedChannelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=20_000)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str | None) -> str | None:
        if name is None:
            raise ValueError("Channel name cannot be null")
        if not name.strip():
            raise ValueError("Channel name cannot be blank")
        return name


class CuratedChannelItemCreate(BaseModel):
    asset_id: str = Field(min_length=1, max_length=36)
    status: ChannelItemStatus = "candidate"


class CuratedChannelItemPatch(BaseModel):
    position: int | None = Field(default=None, ge=0)
    status: ChannelItemStatus | None = None

    @field_validator("position", "status", mode="before")
    @classmethod
    def reject_null_updates(cls, value: Any) -> Any:
        if value is None:
            raise ValueError("This field cannot be null")
        return value


class PlayoutConfigurationPut(BaseModel):
    enabled: bool
    playback_mode: Literal["ordered", "shuffle"]
    loop: bool
    image_duration_seconds: int = Field(ge=3, le=3600)
    item_statuses: list[ChannelItemStatus] = Field(min_length=1, max_length=5)

    @field_validator("item_statuses")
    @classmethod
    def normalize_item_statuses(
        cls, item_statuses: list[ChannelItemStatus]
    ) -> list[ChannelItemStatus]:
        return list(dict.fromkeys(item_statuses))


class PlayoutSessionCreate(BaseModel):
    screen_key: str = Field(min_length=1, max_length=120)

    @field_validator("screen_key")
    @classmethod
    def validate_screen_key(cls, screen_key: str) -> str:
        if not screen_key.strip():
            raise ValueError("Screen key cannot be blank")
        return screen_key.strip()


class PlayoutSessionPatch(BaseModel):
    expected_asset_id: str = Field(min_length=1, max_length=36)
    position_ms: int = Field(ge=0)
    paused: bool


class PlayoutAdvanceCreate(BaseModel):
    expected_asset_id: str = Field(min_length=1, max_length=36)


class AudioExtractionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=1024)
    artist: str = Field(default="", max_length=300)
    release: str = Field(default="", max_length=500)
    year: int | None = Field(default=None, ge=1000, le=9999)
    track_number: int | None = Field(default=None, ge=1, le=999)
    genre: str = Field(default="", max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=50)
    start_ms: int = Field(default=0, ge=0)
    end_ms: int | None = Field(default=None, gt=0)
    format: AudioFormat = "m4a"
    bitrate_kbps: int = Field(default=256, ge=64, le=512)

    @field_validator("title")
    @classmethod
    def validate_title(cls, title: str) -> str:
        if not title.strip():
            raise ValueError("Track title cannot be blank")
        return title

    @field_validator("tags")
    @classmethod
    def validate_music_tags(cls, tags: list[str]) -> list[str]:
        if any(len(tag.strip()) > 120 for tag in tags):
            raise ValueError("Tags must be 120 characters or fewer")
        return tags

    @model_validator(mode="after")
    def validate_range(self):
        if self.end_ms is not None and self.end_ms <= self.start_ms:
            raise ValueError("End time must be after start time")
        return self


class TrackPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=1024)
    artist: str | None = Field(default=None, max_length=300)
    release: str | None = Field(default=None, max_length=500)
    year: int | None = Field(default=None, ge=1000, le=9999)
    track_number: int | None = Field(default=None, ge=1, le=999)
    genre: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = Field(default=None, max_length=50)

    @field_validator("title")
    @classmethod
    def validate_optional_title(cls, title: str | None) -> str | None:
        if title is None or not title.strip():
            raise ValueError("Track title cannot be blank")
        return title

    @field_validator("tags")
    @classmethod
    def validate_optional_tags(cls, tags: list[str] | None) -> list[str] | None:
        if tags is not None and any(len(tag.strip()) > 120 for tag in tags):
            raise ValueError("Tags must be 120 characters or fewer")
        return tags


def create_app(
    *,
    database_url: str,
    storage_roots: Sequence[Mapping[str, Any]],
    derivative_root: str | Path = "./data/derivatives",
    image_upload_max_bytes: int = 25 * 1024 * 1024,
) -> FastAPI:
    engine = create_engine(database_url)
    catalog = Catalog(
        engine,
        storage_roots,
        Path(derivative_root),
        image_upload_max_bytes=image_upload_max_bytes,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        catalog.initialize()
        recovered_tasks = [
            asyncio.create_task(
                asyncio.to_thread(catalog.run_queued_audio_extraction, job_id)
            )
            for job_id in catalog.recover_incomplete_audio_jobs()
        ]
        yield
        if recovered_tasks:
            await asyncio.gather(*recovered_tasks, return_exceptions=True)
        engine.dispose()

    app = FastAPI(title="Hoarder Library", lifespan=lifespan)

    @app.get("/destinations")
    def image_destinations() -> dict[str, Any]:
        return {"destinations": catalog.list_image_destinations()}

    @app.post("/upload")
    async def upload_image(
        image: UploadFile = File(...),
        destination: str = Form(default="", max_length=80),
        source_url: str = Form(default="", max_length=4096),
        page_url: str = Form(default="", max_length=4096),
        page_title: str = Form(default="", max_length=1024),
        tags: str = Form(default="", max_length=8192),
    ) -> JSONResponse:
        if not destination:
            configured_destinations = catalog.list_image_destinations()
            if len(configured_destinations) != 1:
                raise HTTPException(
                    status_code=422,
                    detail="Choose an image destination",
                )
            destination = str(configured_destinations[0]["id"])
        for supplied_url in (source_url, page_url):
            if supplied_url and urlparse(supplied_url).scheme not in {"http", "https"}:
                raise HTTPException(status_code=422, detail="Source URLs must use HTTP or HTTPS")
        if image.content_type is None:
            raise HTTPException(status_code=415, detail="Unsupported image media type")
        content = await image.read(catalog.image_upload_max_bytes + 1)
        await image.close()
        if len(content) > catalog.image_upload_max_bytes:
            raise HTTPException(
                status_code=413, detail="Image exceeds the configured size limit"
            )
        try:
            validated = validate_image(content, image.content_type)
        except UnsupportedImageMediaTypeError as error:
            raise HTTPException(
                status_code=415, detail="Unsupported image media type"
            ) from error
        except InvalidImageError as error:
            raise HTTPException(
                status_code=422, detail="Uploaded content is not a valid image"
            ) from error
        result, ingest_error = catalog.ingest_image(
            destination_key=destination,
            content=content,
            extension=validated.extension,
            filename=image.filename or "saved-image",
            source_url=source_url,
            page_url=page_url,
            page_title=page_title,
            tags=tags.split(","),
        )
        if ingest_error == "not_found":
            raise HTTPException(status_code=404, detail="Image destination was not found")
        if ingest_error == "unavailable":
            raise HTTPException(
                status_code=503, detail="Image destination is unavailable"
            )
        assert result is not None
        return JSONResponse(
            result,
            status_code=201 if result["status"] == "saved" else 200,
        )

    @app.post("/api/scans", status_code=status.HTTP_202_ACCEPTED)
    def scan(background_tasks: BackgroundTasks) -> dict[str, Any]:
        job_id = catalog.queue_scan()
        background_tasks.add_task(catalog.run_queued_scan, job_id)
        return {"job_id": job_id, "status": "queued"}

    @app.get("/api/jobs")
    def list_jobs() -> dict[str, Any]:
        items = catalog.list_jobs()
        return {"items": items, "total": len(items)}

    @app.post("/api/jobs/{job_id}/retry", status_code=status.HTTP_202_ACCEPTED)
    def retry_job(job_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
        queued, error = catalog.retry_job(job_id)
        if error == "not_found":
            raise HTTPException(status_code=404, detail="Job not found")
        if error == "conflict":
            raise HTTPException(status_code=409, detail="Job cannot be retried")
        assert queued
        background_tasks.add_task(catalog.run_queued_audio_extraction, job_id)
        return {"job_id": job_id, "status": "queued"}

    @app.get("/api/roots")
    def list_roots() -> dict[str, Any]:
        items = catalog.list_roots()
        return {"items": items, "total": len(items)}

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return catalog.health()

    @app.get("/api/assets")
    def list_assets(
        media_type: Literal["video", "audio", "image"] | None = None,
        q: str | None = None,
        favorite: bool | None = None,
        workflow_state: WorkflowState | None = None,
        tag: str | None = Query(default=None, max_length=120),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        items, total = catalog.list_assets(
            media_type=media_type,
            query=q,
            favorite=favorite,
            workflow_state=workflow_state,
            tag=tag,
            limit=limit,
            offset=offset,
        )
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    @app.get("/api/assets/{asset_id}/editorial")
    def get_asset_editorial(asset_id: str) -> dict[str, Any]:
        editorial = catalog.get_editorial(asset_id)
        if editorial is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return editorial

    @app.get("/api/assets/{asset_id}")
    def get_asset(asset_id: str) -> dict[str, Any]:
        asset = catalog.get_asset(asset_id)
        if asset is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return asset

    @app.post(
        "/api/assets/{asset_id}/audio-extractions",
        status_code=status.HTTP_202_ACCEPTED,
    )
    def create_audio_extraction(
        asset_id: str,
        payload: AudioExtractionCreate,
        background_tasks: BackgroundTasks,
    ) -> dict[str, Any]:
        job_id, error = catalog.queue_audio_extraction(asset_id, payload.model_dump())
        if error == "not_found":
            raise HTTPException(status_code=404, detail="Asset file is unavailable")
        if error == "wrong_type":
            raise HTTPException(
                status_code=409, detail="Audio can only be extracted from video or audio"
            )
        if error == "conflict":
            raise HTTPException(
                status_code=409,
                detail="This source range and format already has a derivative",
            )
        assert job_id is not None
        background_tasks.add_task(catalog.run_queued_audio_extraction, job_id)
        return {"job_id": job_id, "status": "queued"}

    @app.get("/api/music/tracks")
    def list_tracks(
        q: str | None = None,
        artist: str | None = Query(default=None, max_length=300),
        release: str | None = Query(default=None, max_length=500),
        tag: str | None = Query(default=None, max_length=120),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        items, total = catalog.list_tracks(
            query=q,
            artist=artist,
            release=release,
            tag=tag,
            limit=limit,
            offset=offset,
        )
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    @app.get("/api/music/tracks/{track_id}")
    def get_track(track_id: str) -> dict[str, Any]:
        track = catalog.get_track(track_id)
        if track is None:
            raise HTTPException(status_code=404, detail="Track not found")
        return track

    @app.patch("/api/music/tracks/{track_id}")
    def update_track(track_id: str, payload: TrackPatch) -> dict[str, Any]:
        track = catalog.update_track(track_id, payload.model_dump(exclude_unset=True))
        if track is None:
            raise HTTPException(status_code=404, detail="Track not found")
        return track

    @app.delete("/api/music/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_track(track_id: str) -> Response:
        if not catalog.delete_track(track_id):
            raise HTTPException(status_code=404, detail="Track not found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/music/tracks/{track_id}/stream")
    def stream_track(
        track_id: str, range_header: str | None = Header(None, alias="Range")
    ):
        path = catalog.resolve_track_file(track_id)
        if path is None:
            raise HTTPException(status_code=404, detail="Track file is unavailable")
        return _stream_path(path, range_header)

    @app.get("/api/music/artists")
    def list_artists() -> dict[str, Any]:
        items = catalog.list_artists()
        return {"items": items, "total": len(items)}

    @app.get("/api/music/releases")
    def list_releases() -> dict[str, Any]:
        items = catalog.list_releases()
        return {"items": items, "total": len(items)}

    @app.patch("/api/assets/{asset_id}/editorial")
    def update_asset_editorial(
        asset_id: str, payload: EditorialPatch
    ) -> dict[str, Any]:
        editorial = catalog.update_editorial(
            asset_id, payload.model_dump(exclude_unset=True)
        )
        if editorial is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        return editorial

    @app.get("/api/curated-channels")
    def list_curated_channels() -> dict[str, Any]:
        items = catalog.list_curated_channels()
        return {"items": items, "total": len(items)}

    @app.post("/api/curated-channels", status_code=status.HTTP_201_CREATED)
    def create_curated_channel(payload: CuratedChannelCreate) -> dict[str, Any]:
        return catalog.create_curated_channel(payload.name, payload.description)

    @app.get("/api/curated-channels/{channel_id}")
    def get_curated_channel(channel_id: str) -> dict[str, Any]:
        channel = catalog.get_curated_channel(channel_id)
        if channel is None:
            raise HTTPException(status_code=404, detail="Curated channel not found")
        return channel

    @app.patch("/api/curated-channels/{channel_id}")
    def update_curated_channel(
        channel_id: str, payload: CuratedChannelPatch
    ) -> dict[str, Any]:
        channel = catalog.update_curated_channel(
            channel_id, payload.model_dump(exclude_unset=True)
        )
        if channel is None:
            raise HTTPException(status_code=404, detail="Curated channel not found")
        return channel

    @app.delete(
        "/api/curated-channels/{channel_id}", status_code=status.HTTP_204_NO_CONTENT
    )
    def delete_curated_channel(channel_id: str) -> Response:
        if not catalog.delete_curated_channel(channel_id):
            raise HTTPException(status_code=404, detail="Curated channel not found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/curated-channels/{channel_id}/items")
    def list_curated_channel_items(channel_id: str) -> dict[str, Any]:
        items, total = catalog.list_curated_channel_items(channel_id)
        if items is None:
            raise HTTPException(status_code=404, detail="Curated channel not found")
        return {"items": items, "total": total}

    @app.post(
        "/api/curated-channels/{channel_id}/items",
        status_code=status.HTTP_201_CREATED,
    )
    def add_curated_channel_item(
        channel_id: str, payload: CuratedChannelItemCreate
    ) -> dict[str, Any]:
        item, error = catalog.add_curated_channel_item(
            channel_id, payload.asset_id, payload.status
        )
        if error == "not_found":
            raise HTTPException(status_code=404, detail="Channel or asset not found")
        if error == "conflict":
            raise HTTPException(
                status_code=409, detail="Asset is already in this curated channel"
            )
        assert item is not None
        return item

    @app.patch("/api/curated-channels/{channel_id}/items/{asset_id}")
    def update_curated_channel_item(
        channel_id: str, asset_id: str, payload: CuratedChannelItemPatch
    ) -> dict[str, Any]:
        item = catalog.update_curated_channel_item(
            channel_id, asset_id, payload.model_dump(exclude_unset=True)
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Curated channel item not found")
        return item

    @app.delete(
        "/api/curated-channels/{channel_id}/items/{asset_id}",
        status_code=status.HTTP_204_NO_CONTENT,
    )
    def delete_curated_channel_item(channel_id: str, asset_id: str) -> Response:
        if not catalog.delete_curated_channel_item(channel_id, asset_id):
            raise HTTPException(status_code=404, detail="Curated channel item not found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/curated-channels/{channel_id}/playout")
    def get_playout_configuration(channel_id: str) -> dict[str, Any]:
        configuration = catalog.get_playout_configuration(channel_id)
        if configuration is None:
            raise HTTPException(status_code=404, detail="Curated channel not found")
        return configuration

    @app.get("/api/playout/channels")
    def list_playout_channels() -> dict[str, Any]:
        items = catalog.list_playout_channels()
        return {"items": items, "total": len(items)}

    @app.put("/api/curated-channels/{channel_id}/playout")
    def update_playout_configuration(
        channel_id: str, payload: PlayoutConfigurationPut
    ) -> dict[str, Any]:
        configuration = catalog.update_playout_configuration(
            channel_id, payload.model_dump()
        )
        if configuration is None:
            raise HTTPException(status_code=404, detail="Curated channel not found")
        return configuration

    @app.post("/api/curated-channels/{channel_id}/playout-sessions")
    def start_playout_session(
        channel_id: str, payload: PlayoutSessionCreate
    ) -> JSONResponse:
        playout_session, created, error = catalog.start_playout_session(
            channel_id, payload.screen_key
        )
        if error == "not_found":
            raise HTTPException(status_code=404, detail="Curated channel not found")
        if error == "disabled":
            raise HTTPException(status_code=409, detail="Channel playout is disabled")
        if error == "empty":
            raise HTTPException(
                status_code=409, detail="Channel has no eligible online media"
            )
        assert playout_session is not None
        return JSONResponse(
            playout_session,
            status_code=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    @app.get("/api/playout-sessions/{session_id}")
    def get_playout_session(session_id: str) -> dict[str, Any]:
        playout_session = catalog.get_playout_session(session_id)
        if playout_session is None:
            raise HTTPException(status_code=404, detail="Playout session not found")
        return playout_session

    @app.patch("/api/playout-sessions/{session_id}")
    def update_playout_session(
        session_id: str, payload: PlayoutSessionPatch
    ) -> dict[str, Any]:
        playout_session, error = catalog.update_playout_session(
            session_id, payload.model_dump()
        )
        if error == "not_found":
            raise HTTPException(status_code=404, detail="Playout session not found")
        if error == "stale":
            raise HTTPException(
                status_code=409, detail="Screen state is stale; refresh the session"
            )
        assert playout_session is not None
        return playout_session

    @app.post("/api/playout-sessions/{session_id}/advance")
    def advance_playout_session(
        session_id: str, payload: PlayoutAdvanceCreate
    ) -> dict[str, Any]:
        playout_session, error = catalog.advance_playout_session(
            session_id, payload.expected_asset_id
        )
        if error == "not_found":
            raise HTTPException(status_code=404, detail="Playout session not found")
        if error == "stale":
            raise HTTPException(
                status_code=409, detail="Screen state is stale; refresh the session"
            )
        assert playout_session is not None
        return playout_session

    @app.get("/api/channels")
    def list_channels(
        q: str | None = None,
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        items, total = catalog.list_channels(query=q, limit=limit, offset=offset)
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    @app.get("/api/channels/{channel_id}/assets")
    def list_channel_assets(
        channel_id: str,
        media_type: Literal["video", "audio"] | None = None,
        q: str | None = None,
        favorite: bool | None = None,
        workflow_state: WorkflowState | None = None,
        tag: str | None = Query(default=None, max_length=120),
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        items, total = catalog.list_assets(
            media_type=media_type,
            query=q,
            channel_id=channel_id,
            favorite=favorite,
            workflow_state=workflow_state,
            tag=tag,
            limit=limit,
            offset=offset,
        )
        return {"items": items, "total": total, "limit": limit, "offset": offset}

    @app.get("/api/channels/{channel_id}/thumbnail")
    def channel_thumbnail(channel_id: str):
        path = catalog.resolve_channel_thumbnail(channel_id)
        if path is None:
            raise HTTPException(
                status_code=404, detail="Channel thumbnail is unavailable"
            )
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return FileResponse(path, media_type=media_type)

    @app.get("/api/assets/{asset_id}/stream")
    def stream_asset(
        asset_id: str, range_header: str | None = Header(None, alias="Range")
    ):
        path = catalog.resolve_asset_file(asset_id)
        if path is None:
            raise HTTPException(status_code=404, detail="Asset file is unavailable")
        return _stream_path(path, range_header)

    @app.get("/api/assets/{asset_id}/thumbnail")
    def asset_thumbnail(asset_id: str):
        path = catalog.resolve_thumbnail(asset_id)
        if path is None:
            raise HTTPException(
                status_code=404, detail="Asset thumbnail is unavailable"
            )
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return FileResponse(path, media_type=media_type)

    return app


def _stream_path(path: Path, range_header: str | None) -> StreamingResponse:
    size = path.stat().st_size
    start, end, response_status = _parse_range(range_header, size)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
    }
    if response_status == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return StreamingResponse(
        _read_range(path, start, end),
        status_code=response_status,
        headers=headers,
        media_type=media_type,
    )


def _parse_range(value: str | None, size: int) -> tuple[int, int, int]:
    if value is None:
        return 0, max(size - 1, 0), 200
    try:
        unit, positions = value.split("=", 1)
        start_text, end_text = positions.split("-", 1)
        if unit != "bytes" or not start_text:
            raise ValueError
        start = int(start_text)
        end = int(end_text) if end_text else size - 1
        if start < 0 or end < start or end >= size:
            raise ValueError
        return start, end, 206
    except ValueError as error:
        raise HTTPException(
            status_code=416,
            detail="Invalid byte range",
            headers={"Content-Range": f"bytes */{size}"},
        ) from error


def _read_range(path: Path, start: int, end: int):
    remaining = end - start + 1
    with path.open("rb") as stream:
        stream.seek(start)
        while remaining:
            chunk = stream.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
