from collections.abc import Mapping, Sequence
from hashlib import sha256
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, selectinload

from .models import Asset, AssetFile, Base, Job, StorageRoot

MEDIA_TYPES = {
    ".avi": "video",
    ".m4v": "video",
    ".mkv": "video",
    ".mov": "video",
    ".mp4": "video",
    ".webm": "video",
    ".aac": "audio",
    ".flac": "audio",
    ".m4a": "audio",
    ".mp3": "audio",
    ".ogg": "audio",
    ".wav": "audio",
    ".avif": "image",
    ".gif": "image",
    ".jpeg": "image",
    ".jpg": "image",
    ".png": "image",
    ".webp": "image",
}


class Catalog:
    def __init__(
        self, engine: Engine, storage_roots: Sequence[Mapping[str, Any]]
    ) -> None:
        self.engine = engine
        self.storage_roots = storage_roots

    def initialize(self) -> None:
        Base.metadata.create_all(self.engine)
        with Session(self.engine) as session:
            for configured in self.storage_roots:
                root = session.scalar(
                    select(StorageRoot).where(StorageRoot.key == configured["key"])
                )
                if root is None:
                    root = StorageRoot(
                        key=str(configured["key"]),
                        label=str(configured["label"]),
                        path=str(configured["path"]),
                        sentinel=(
                            str(configured["sentinel"])
                            if configured.get("sentinel")
                            else None
                        ),
                    )
                    session.add(root)
                else:
                    root.label = str(configured["label"])
                    root.path = str(configured["path"])
                    root.sentinel = (
                        str(configured["sentinel"])
                        if configured.get("sentinel")
                        else None
                    )
            session.commit()

    def scan(self) -> dict[str, int]:
        discovered = 0
        with Session(self.engine) as session:
            job = Job(kind="storage_scan", status="running")
            session.add(job)
            session.flush()
            roots = session.scalars(select(StorageRoot)).all()
            for root in roots:
                path = Path(root.path)
                if not path.is_dir():
                    root.health = "offline"
                    continue
                if root.sentinel and not (path / root.sentinel).is_file():
                    root.health = "degraded"
                    continue
                root.health = "online"
                for candidate in path.rglob("*"):
                    media_type = MEDIA_TYPES.get(candidate.suffix.lower())
                    if not candidate.is_file() or media_type is None:
                        continue
                    relative_path = candidate.relative_to(path).as_posix()
                    existing = session.scalar(
                        select(AssetFile).where(
                            AssetFile.root_id == root.id,
                            AssetFile.relative_path == relative_path,
                        )
                    )
                    if existing is not None:
                        stat = candidate.stat()
                        if (
                            existing.size != stat.st_size
                            or existing.mtime_ns != stat.st_mtime_ns
                        ):
                            existing.size = stat.st_size
                            existing.mtime_ns = stat.st_mtime_ns
                            existing.fingerprint = _fingerprint(candidate)
                        existing.asset.status = "available"
                        continue
                    stat = candidate.stat()
                    fingerprint = _fingerprint(candidate)
                    moved_file = session.scalar(
                        select(AssetFile)
                        .where(
                            AssetFile.root_id == root.id,
                            AssetFile.fingerprint == fingerprint,
                        )
                        .options(selectinload(AssetFile.asset))
                    )
                    if (
                        moved_file is not None
                        and not (path / moved_file.relative_path).exists()
                    ):
                        moved_file.relative_path = relative_path
                        moved_file.size = stat.st_size
                        moved_file.mtime_ns = stat.st_mtime_ns
                        moved_file.asset.status = "available"
                        continue
                    duplicate_file = session.scalar(
                        select(AssetFile)
                        .where(AssetFile.fingerprint == fingerprint)
                        .options(selectinload(AssetFile.asset))
                        .limit(1)
                    )
                    if duplicate_file is not None:
                        duplicate_file.asset.files.append(
                            AssetFile(
                                root=root,
                                relative_path=relative_path,
                                size=stat.st_size,
                                mtime_ns=stat.st_mtime_ns,
                                fingerprint=fingerprint,
                            )
                        )
                        continue
                    asset = Asset(title=candidate.stem, media_type=media_type)
                    asset.files.append(
                        AssetFile(
                            root=root,
                            relative_path=relative_path,
                            size=stat.st_size,
                            mtime_ns=stat.st_mtime_ns,
                            fingerprint=fingerprint,
                        )
                    )
                    session.add(asset)
                    discovered += 1
            assets = session.scalars(
                select(Asset).options(
                    selectinload(Asset.files).selectinload(AssetFile.root)
                )
            ).all()
            for asset in assets:
                locations = [
                    (
                        asset_file.root.health,
                        (
                            Path(asset_file.root.path) / asset_file.relative_path
                        ).is_file(),
                    )
                    for asset_file in asset.files
                ]
                if any(health == "online" and exists for health, exists in locations):
                    asset.status = "available"
                elif locations and all(health == "online" for health, _ in locations):
                    asset.status = "missing"
            job.status = "completed"
            job.result = {"discovered": discovered}
            session.commit()
            job_id = job.id
        return {"discovered": discovered, "job_id": job_id}

    def list_assets(
        self,
        *,
        media_type: str | None = None,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        with Session(self.engine) as session:
            statement = select(Asset).options(selectinload(Asset.files))
            if media_type is not None:
                statement = statement.where(Asset.media_type == media_type)
            if query:
                statement = statement.where(Asset.title.ilike(f"%{query}%"))
            total = session.scalar(
                select(func.count()).select_from(statement.order_by(None).subquery())
            )
            assets = session.scalars(
                statement.order_by(Asset.created_at.desc()).limit(limit).offset(offset)
            ).all()
            items = [
                {
                    "id": asset.id,
                    "title": asset.title,
                    "media_type": asset.media_type,
                    "status": asset.status,
                    "files": [
                        {
                            "id": file.id,
                            "relative_path": file.relative_path,
                            "size": file.size,
                        }
                        for file in asset.files
                    ],
                }
                for asset in assets
            ]
            return items, int(total or 0)

    def resolve_asset_file(self, asset_id: str) -> Path | None:
        with Session(self.engine) as session:
            asset_files = session.scalars(
                select(AssetFile)
                .where(AssetFile.asset_id == asset_id)
                .options(selectinload(AssetFile.root))
            ).all()
            for asset_file in asset_files:
                if asset_file.root.health != "online":
                    continue
                root_path = Path(asset_file.root.path).resolve()
                candidate = (root_path / asset_file.relative_path).resolve()
                if candidate.is_relative_to(root_path) and candidate.is_file():
                    return candidate
            return None

    def list_jobs(self) -> list[dict[str, Any]]:
        with Session(self.engine) as session:
            jobs = session.scalars(select(Job).order_by(Job.created_at.desc())).all()
            return [
                {
                    "id": job.id,
                    "kind": job.kind,
                    "status": job.status,
                    "result": job.result,
                    "created_at": job.created_at.isoformat(),
                }
                for job in jobs
            ]

    def list_roots(self) -> list[dict[str, str]]:
        with Session(self.engine) as session:
            roots = session.scalars(select(StorageRoot).order_by(StorageRoot.id)).all()
            return [
                {"key": root.key, "label": root.label, "health": root.health}
                for root in roots
            ]

    def health(self) -> dict[str, Any]:
        with Session(self.engine) as session:
            session.execute(select(1))
            states = {"online": 0, "degraded": 0, "offline": 0, "unknown": 0}
            for health in session.scalars(select(StorageRoot.health)):
                states[health if health in states else "unknown"] += 1
        return {"status": "ok", "database": "ok", "roots": states}


def _fingerprint(path: Path) -> str:
    digest = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
