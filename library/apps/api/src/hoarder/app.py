import mimetypes
from collections.abc import AsyncIterator, Mapping, Sequence
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import create_engine

from .catalog import Catalog


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
        limit: int = Query(default=50, ge=1, le=200),
        offset: int = Query(default=0, ge=0),
    ) -> dict[str, Any]:
        items, total = catalog.list_assets(
            media_type=media_type, query=q, limit=limit, offset=offset
        )
        return {"items": items, "total": total, "limit": limit, "offset": offset}

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
