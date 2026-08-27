import mimetypes
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import create_engine

from .catalog import Catalog

WorkflowState = Literal["inbox", "candidate", "reviewed", "selected", "archived"]
ChannelItemStatus = Literal["candidate", "reviewed", "selected", "used", "rejected"]


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


def create_app(
    *, database_url: str, storage_roots: Sequence[Mapping[str, Any]]
) -> FastAPI:
    engine = create_engine(database_url)
    catalog = Catalog(engine, storage_roots)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        catalog.initialize()
        yield
        engine.dispose()

    app = FastAPI(title="Hoarder Library", lifespan=lifespan)

    @app.post("/api/scans", status_code=status.HTTP_202_ACCEPTED)
    def scan(background_tasks: BackgroundTasks) -> dict[str, Any]:
        job_id = catalog.queue_scan()
        background_tasks.add_task(catalog.run_queued_scan, job_id)
        return {"job_id": job_id, "status": "queued"}

    @app.get("/api/jobs")
    def list_jobs() -> dict[str, Any]:
        items = catalog.list_jobs()
        return {"items": items, "total": len(items)}

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
        size = path.stat().st_size
        start, end, status = _parse_range(range_header, size)
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(end - start + 1),
        }
        if status == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return StreamingResponse(
            _read_range(path, start, end),
            status_code=status,
            headers=headers,
            media_type=media_type,
        )

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
