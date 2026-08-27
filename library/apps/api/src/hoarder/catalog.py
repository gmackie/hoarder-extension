import json
from collections.abc import Mapping, Sequence
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, func, select
from sqlalchemy.orm import Session, selectinload

from .fingerprints import fingerprint_media
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
        self.exclude_patterns = {
            str(root["key"]): tuple(
                str(pattern) for pattern in root.get("exclude_patterns", [])
            )
            for root in storage_roots
        }
        self.thumbnail_patterns = {
            str(root["key"]): tuple(
                str(pattern) for pattern in root.get("thumbnail_patterns", [])
            )
            for root in storage_roots
        }
        self.channel_path_prefixes = {
            str(root["key"]): tuple(
                str(prefix) for prefix in root.get("channel_path_prefixes", [])
            )
            for root in storage_roots
        }
        self.channel_metadata_paths = {
            str(root["key"]): (
                str(root["channel_metadata_path"])
                if root.get("channel_metadata_path")
                else None
            )
            for root in storage_roots
        }
        self.channel_thumbnail_patterns = {
            str(root["key"]): tuple(
                str(pattern)
                for pattern in root.get("channel_thumbnail_patterns", [])
            )
            for root in storage_roots
        }

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

    def queue_scan(self) -> str:
        with Session(self.engine) as session:
            active_job = session.scalar(
                select(Job)
                .where(
                    Job.kind == "storage_scan",
                    Job.status.in_(("queued", "running")),
                )
                .order_by(Job.created_at.desc())
                .limit(1)
            )
            if active_job is not None:
                return active_job.id
            job = Job(kind="storage_scan", status="queued")
            session.add(job)
            session.commit()
            return job.id

    def run_queued_scan(self, job_id: str) -> None:
        try:
            self._run_scan(job_id)
        except Exception as error:
            with Session(self.engine) as session:
                job = session.get(Job, job_id)
                if job is not None:
                    job.status = "failed"
                    job.result = {"error": type(error).__name__}
                    session.commit()
            raise

    def _run_scan(self, job_id: str) -> None:
        discovered = 0
        with Session(self.engine) as session:
            job = session.get(Job, job_id)
            if job is None:
                return
            job.status = "running"
            session.commit()
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
                    if self._is_excluded(root.key, relative_path):
                        continue
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
                            existing.fingerprint = fingerprint_media(candidate)
                        existing.asset.status = "available"
                        continue
                    stat = candidate.stat()
                    fingerprint = fingerprint_media(candidate)
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
                        self._is_excluded(
                            asset_file.root.key, asset_file.relative_path
                        ),
                    )
                    for asset_file in asset.files
                ]
                if any(
                    health == "online" and exists and not excluded
                    for health, exists, excluded in locations
                ):
                    asset.status = "available"
                elif locations and all(excluded for _, _, excluded in locations):
                    asset.status = "excluded"
                elif locations and all(
                    health == "online" for health, _, _ in locations
                ):
                    asset.status = "missing"
            job.status = "completed"
            job.result = {"discovered": discovered}
            session.commit()

    def list_assets(
        self,
        *,
        media_type: str | None = None,
        query: str | None = None,
        channel_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        with Session(self.engine) as session:
            statement = (
                select(Asset)
                .where(Asset.status != "excluded")
                .options(selectinload(Asset.files).selectinload(AssetFile.root))
            )
            if media_type is not None:
                statement = statement.where(Asset.media_type == media_type)
            if query:
                statement = statement.where(Asset.title.ilike(f"%{query}%"))
            ordered_statement = statement.order_by(Asset.created_at.desc())
            if channel_id is None:
                total = session.scalar(
                    select(func.count()).select_from(
                        statement.order_by(None).subquery()
                    )
                )
                assets = session.scalars(
                    ordered_statement.limit(limit).offset(offset)
                ).all()
            else:
                matching_assets = [
                    asset
                    for asset in session.scalars(ordered_statement).all()
                    if channel_id in self._asset_channel_ids(asset.files)
                ]
                total = len(matching_assets)
                assets = matching_assets[offset : offset + limit]
            items = [
                {
                    "id": asset.id,
                    "title": asset.title,
                    "media_type": asset.media_type,
                    "status": asset.status,
                    "thumbnail_url": (
                        f"/api/assets/{asset.id}/thumbnail"
                        if self._resolve_thumbnail_from_files(asset.files) is not None
                        else None
                    ),
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

    def list_channels(
        self,
        *,
        query: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        with Session(self.engine) as session:
            assets = session.scalars(
                select(Asset)
                .where(
                    Asset.status != "excluded",
                    Asset.media_type.in_(("video", "audio")),
                )
                .options(selectinload(Asset.files).selectinload(AssetFile.root))
            ).all()
            roots = session.scalars(select(StorageRoot)).all()
            metadata = self._load_channel_metadata(roots)
            grouped: dict[str, dict[str, set[str]]] = {}
            for asset in assets:
                for channel_id in self._asset_channel_ids(asset.files):
                    counts = grouped.setdefault(
                        channel_id,
                        {"video": set(), "audio": set(), "root_keys": set()},
                    )
                    counts[asset.media_type].add(asset.id)
                    counts["root_keys"].update(
                        asset_file.root.key
                        for asset_file in asset.files
                        if self._channel_id_for_file(asset_file) == channel_id
                    )

            items: list[dict[str, Any]] = []
            for channel_id, counts in grouped.items():
                details = metadata.get(channel_id, {})
                title = str(details.get("title") or channel_id)
                subscribers = details.get("subscribers")
                if not isinstance(subscribers, int):
                    subscribers = None
                thumbnail = self._resolve_channel_thumbnail_from_roots(
                    channel_id,
                    [root for root in roots if root.key in counts["root_keys"]],
                )
                video_count = len(counts["video"])
                audio_count = len(counts["audio"])
                items.append(
                    {
                        "id": channel_id,
                        "title": title,
                        "video_count": video_count,
                        "audio_count": audio_count,
                        "total_count": video_count + audio_count,
                        "subscribers": subscribers,
                        "thumbnail_url": (
                            f"/api/channels/{channel_id}/thumbnail"
                            if thumbnail is not None
                            else None
                        ),
                    }
                )

            if query:
                normalized_query = query.casefold()
                items = [
                    item
                    for item in items
                    if normalized_query in str(item["title"]).casefold()
                    or normalized_query in str(item["id"]).casefold()
                ]
            items.sort(key=lambda item: (str(item["title"]).casefold(), item["id"]))
            total = len(items)
            return items[offset : offset + limit], total

    def _channel_id_for_file(self, asset_file: AssetFile) -> str | None:
        path_parts = Path(asset_file.relative_path).parts
        for prefix in self.channel_path_prefixes.get(asset_file.root.key, ()):
            prefix_parts = Path(prefix).parts
            if (
                prefix_parts
                and tuple(path_parts[: len(prefix_parts)]) == prefix_parts
                and len(path_parts) > len(prefix_parts)
            ):
                return path_parts[len(prefix_parts)]
        return None

    def _asset_channel_ids(self, asset_files: Sequence[AssetFile]) -> set[str]:
        return {
            channel_id
            for asset_file in asset_files
            if (channel_id := self._channel_id_for_file(asset_file)) is not None
        }

    def _load_channel_metadata(
        self, roots: Sequence[StorageRoot]
    ) -> dict[str, dict[str, Any]]:
        channels: dict[str, dict[str, Any]] = {}
        for root in roots:
            relative_path = self.channel_metadata_paths.get(root.key)
            if not relative_path:
                continue
            root_path = Path(root.path).resolve()
            candidate = (root_path / relative_path).resolve()
            if not candidate.is_relative_to(root_path) or not candidate.is_file():
                continue
            try:
                payload = json.loads(candidate.read_text())
            except (OSError, UnicodeDecodeError, json.JSONDecodeError):
                continue
            configured_channels = (
                payload.get("channels") if isinstance(payload, dict) else None
            )
            if not isinstance(configured_channels, dict):
                continue
            for channel_id, details in configured_channels.items():
                if isinstance(channel_id, str) and isinstance(details, dict):
                    channels[channel_id] = details
        return channels

    def resolve_channel_thumbnail(self, channel_id: str) -> Path | None:
        with Session(self.engine) as session:
            roots = session.scalars(select(StorageRoot)).all()
            return self._resolve_channel_thumbnail_from_roots(channel_id, roots)

    def _resolve_channel_thumbnail_from_roots(
        self, channel_id: str, roots: Sequence[StorageRoot]
    ) -> Path | None:
        if (
            not channel_id
            or len(channel_id) > 160
            or "/" in channel_id
            or "\\" in channel_id
        ):
            return None
        for root in roots:
            if root.health != "online":
                continue
            root_path = Path(root.path).resolve()
            for pattern in self.channel_thumbnail_patterns.get(root.key, ()):
                try:
                    relative_thumbnail = pattern.format(channel_id=channel_id)
                except (KeyError, ValueError):
                    continue
                candidate = (root_path / relative_thumbnail).resolve()
                if (
                    candidate.is_relative_to(root_path)
                    and candidate.suffix.lower()
                    in {".avif", ".jpeg", ".jpg", ".png", ".webp"}
                    and candidate.is_file()
                ):
                    return candidate
        return None

    def _is_excluded(self, root_key: str, relative_path: str) -> bool:
        return any(
            fnmatchcase(relative_path, pattern)
            for pattern in self.exclude_patterns.get(root_key, ())
        )

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

    def resolve_thumbnail(self, asset_id: str) -> Path | None:
        with Session(self.engine) as session:
            asset = session.scalar(
                select(Asset)
                .where(Asset.id == asset_id)
                .options(selectinload(Asset.files).selectinload(AssetFile.root))
            )
            if asset is None or asset.media_type not in {"video", "audio"}:
                return None
            return self._resolve_thumbnail_from_files(asset.files)

    def _resolve_thumbnail_from_files(
        self, asset_files: Sequence[AssetFile]
    ) -> Path | None:
        for asset_file in asset_files:
            root = asset_file.root
            if root.health != "online":
                continue
            source = Path(asset_file.relative_path)
            values = {
                "stem": source.stem,
                "first": source.stem[:1].lower(),
                "parent": source.parent.as_posix(),
            }
            root_path = Path(root.path).resolve()
            for pattern in self.thumbnail_patterns.get(root.key, ()):
                try:
                    relative_thumbnail = pattern.format(**values)
                except (KeyError, ValueError):
                    continue
                candidate = (root_path / relative_thumbnail).resolve()
                if (
                    candidate.is_relative_to(root_path)
                    and candidate.suffix.lower()
                    in {".avif", ".jpeg", ".jpg", ".png", ".webp"}
                    and candidate.is_file()
                ):
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
