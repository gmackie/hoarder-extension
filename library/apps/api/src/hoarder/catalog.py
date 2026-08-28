import json
import hashlib
import os
import tempfile
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .fingerprints import fingerprint_media
from .audio import AudioExtractionError, AudioExtractor
from .models import (
    Asset,
    AssetEditorial,
    AssetFile,
    AssetOrigin,
    Base,
    CuratedChannel,
    CuratedChannelItem,
    Derivative,
    Artist,
    Job,
    Release,
    StorageRoot,
    Tag,
    Track,
)

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
        self,
        engine: Engine,
        storage_roots: Sequence[Mapping[str, Any]],
        derivative_root: Path,
        image_upload_max_bytes: int = 25 * 1024 * 1024,
    ) -> None:
        self.engine = engine
        self.storage_roots = storage_roots
        self.audio_extractor = AudioExtractor(derivative_root)
        self.image_upload_max_bytes = image_upload_max_bytes
        self.root_config_by_key = {
            str(root["key"]): root for root in storage_roots
        }
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
        self.audio_extractor.initialize()
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
                root.writable = bool(configured.get("writable", False))
                root.accepts_images = bool(
                    configured.get("accepts_images", False)
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
        favorite: bool | None = None,
        workflow_state: str | None = None,
        tag: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        with Session(self.engine) as session:
            statement = (
                select(Asset)
                .where(Asset.status != "excluded")
                .options(
                    selectinload(Asset.files).selectinload(AssetFile.root),
                    selectinload(Asset.editorial),
                    selectinload(Asset.tags),
                    selectinload(Asset.origins),
                )
            )
            if media_type is not None:
                statement = statement.where(Asset.media_type == media_type)
            if query:
                statement = statement.where(Asset.title.ilike(f"%{query}%"))
            if favorite is not None or workflow_state is not None:
                statement = statement.outerjoin(AssetEditorial)
            if favorite is True:
                statement = statement.where(AssetEditorial.favorite.is_(True))
            elif favorite is False:
                statement = statement.where(
                    or_(
                        AssetEditorial.asset_id.is_(None),
                        AssetEditorial.favorite.is_(False),
                    )
                )
            if workflow_state == "inbox":
                statement = statement.where(
                    or_(
                        AssetEditorial.asset_id.is_(None),
                        AssetEditorial.workflow_state == "inbox",
                    )
                )
            elif workflow_state is not None:
                statement = statement.where(
                    AssetEditorial.workflow_state == workflow_state
                )
            if tag:
                statement = statement.join(Asset.tags).where(
                    Tag.name == self._normalize_tag(tag)
                )
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
            items = [self._serialize_asset(asset) for asset in assets]
            return items, int(total or 0)

    def _serialize_asset(self, asset: Asset) -> dict[str, Any]:
        return {
            "id": asset.id,
            "title": asset.title,
            "media_type": asset.media_type,
            "status": asset.status,
            "thumbnail_url": (
                f"/api/assets/{asset.id}/thumbnail"
                if self._resolve_thumbnail_from_files(asset.files) is not None
                else None
            ),
            "editorial": self._serialize_editorial(asset),
            "files": [
                {
                    "id": asset_file.id,
                    "relative_path": asset_file.relative_path,
                    "size": asset_file.size,
                }
                for asset_file in asset.files
            ],
            "origins": [
                {
                    "source_url": origin.source_url,
                    "page_url": origin.page_url,
                    "page_title": origin.page_title,
                    "original_filename": origin.original_filename,
                    "destination": origin.destination,
                    "captured_at": origin.captured_at.isoformat(),
                }
                for origin in asset.origins
            ],
        }

    def get_asset(self, asset_id: str) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            asset = session.scalar(
                select(Asset)
                .where(Asset.id == asset_id, Asset.status != "excluded")
                .options(
                    selectinload(Asset.files).selectinload(AssetFile.root),
                    selectinload(Asset.editorial),
                    selectinload(Asset.tags),
                    selectinload(Asset.origins),
                )
            )
            return self._serialize_asset(asset) if asset is not None else None

    def get_editorial(self, asset_id: str) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            asset = session.scalar(
                select(Asset)
                .where(Asset.id == asset_id)
                .options(selectinload(Asset.editorial), selectinload(Asset.tags))
            )
            return self._serialize_editorial(asset) if asset is not None else None

    def update_editorial(
        self, asset_id: str, updates: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            asset = session.scalar(
                select(Asset)
                .where(Asset.id == asset_id)
                .options(selectinload(Asset.editorial), selectinload(Asset.tags))
            )
            if asset is None:
                return None
            if asset.editorial is None:
                asset.editorial = AssetEditorial()
            for field in ("rating", "favorite", "workflow_state", "notes"):
                if field in updates:
                    value = updates[field]
                    if field == "notes" and value is None:
                        value = ""
                    setattr(asset.editorial, field, value)
            if "tags" in updates:
                normalized_names = sorted(
                    {
                        normalized
                        for value in (updates["tags"] or [])
                        if (normalized := self._normalize_tag(value))
                    }
                )
                tags_by_name = {
                    tag.name: tag
                    for tag in session.scalars(
                        select(Tag).where(Tag.name.in_(normalized_names))
                    ).all()
                }
                for name in normalized_names:
                    if name in tags_by_name:
                        continue
                    tag = Tag(name=name)
                    try:
                        with session.begin_nested():
                            session.add(tag)
                            session.flush()
                    except IntegrityError:
                        concurrent_tag = session.scalar(
                            select(Tag).where(Tag.name == name)
                        )
                        if concurrent_tag is None:
                            raise
                        tag = concurrent_tag
                    tags_by_name[name] = tag
                asset.tags = [
                    tags_by_name[name] for name in normalized_names
                ]
            session.commit()
            return self._serialize_editorial(asset)

    def _serialize_editorial(self, asset: Asset) -> dict[str, Any]:
        editorial = asset.editorial
        return {
            "asset_id": asset.id,
            "rating": editorial.rating if editorial is not None else None,
            "favorite": editorial.favorite if editorial is not None else False,
            "workflow_state": (
                editorial.workflow_state if editorial is not None else "inbox"
            ),
            "notes": editorial.notes if editorial is not None else "",
            "tags": sorted(tag.name for tag in asset.tags),
        }

    @staticmethod
    def _normalize_tag(value: str) -> str:
        return " ".join(value.strip().casefold().split())[:120]

    def list_image_destinations(self) -> list[dict[str, Any]]:
        destinations = []
        for configured in self.storage_roots:
            if not configured.get("accepts_images", False):
                continue
            path = Path(str(configured["path"]))
            destinations.append(
                {
                    "id": str(configured["key"]),
                    "label": str(configured["label"]),
                    "available": bool(
                        configured.get("writable", False)
                        and path.is_dir()
                        and os.access(path, os.W_OK)
                    ),
                }
            )
        return destinations

    def ingest_image(
        self,
        *,
        destination_key: str,
        content: bytes,
        extension: str,
        filename: str,
        source_url: str,
        page_url: str,
        page_title: str,
        tags: Sequence[str],
    ) -> tuple[dict[str, Any] | None, str | None]:
        configured = self.root_config_by_key.get(destination_key)
        if configured is None or not configured.get("accepts_images", False):
            return None, "not_found"
        root_path = Path(str(configured["path"]))
        if (
            not configured.get("writable", False)
            or not root_path.is_dir()
            or not os.access(root_path, os.W_OK)
        ):
            return None, "unavailable"

        fingerprint_digest = hashlib.sha256()
        fingerprint_digest.update(
            len(content).to_bytes(8, byteorder="big", signed=False)
        )
        fingerprint_digest.update(content)
        fingerprint = fingerprint_digest.hexdigest()
        safe_filename = Path(filename.replace("\\", "/")).name[:1024]
        title = Path(safe_filename).stem.strip()[:1024] or "Saved image"
        normalized_names = sorted(
            {
                normalized
                for value in tags
                if (normalized := self._normalize_tag(value))
            }
        )

        with Session(self.engine) as session:
            duplicate_file = session.scalar(
                select(AssetFile)
                .join(Asset)
                .where(
                    AssetFile.fingerprint == fingerprint,
                    Asset.media_type == "image",
                )
                .options(
                    selectinload(AssetFile.asset).selectinload(Asset.origins),
                    selectinload(AssetFile.asset).selectinload(Asset.tags),
                )
                .limit(1)
            )
            if duplicate_file is not None:
                asset = duplicate_file.asset
                self._record_origin(
                    asset,
                    destination_key=destination_key,
                    source_url=source_url,
                    page_url=page_url,
                    page_title=page_title,
                    filename=safe_filename,
                )
                asset.tags = self._merge_tags(session, asset.tags, normalized_names)
                asset.status = "available"
                session.commit()
                return {
                    "asset_id": asset.id,
                    "status": "duplicate",
                    "destination": destination_key,
                    "asset_url": f"/api/assets/{asset.id}",
                }, None

            root = session.scalar(
                select(StorageRoot).where(StorageRoot.key == destination_key)
            )
            if root is None:
                return None, "not_found"
            relative_path = f"images/{fingerprint[:2]}/{fingerprint}{extension}"
            final_path = (root_path / relative_path).resolve()
            if not final_path.is_relative_to(root_path.resolve()):
                return None, "unavailable"
            final_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path: Path | None = None
            created_file = False
            try:
                if not final_path.exists():
                    with tempfile.NamedTemporaryFile(
                        mode="wb",
                        dir=final_path.parent,
                        prefix=".upload-",
                        suffix=".part",
                        delete=False,
                    ) as temporary:
                        temporary.write(content)
                        temporary.flush()
                        os.fsync(temporary.fileno())
                        temporary_path = Path(temporary.name)
                    os.replace(temporary_path, final_path)
                    temporary_path = None
                    created_file = True
                stat = final_path.stat()
                if stat.st_size != len(content):
                    return None, "unavailable"
                asset = Asset(title=title, media_type="image")
                asset.files.append(
                    AssetFile(
                        root=root,
                        relative_path=relative_path,
                        size=stat.st_size,
                        mtime_ns=stat.st_mtime_ns,
                        fingerprint=fingerprint,
                    )
                )
                self._record_origin(
                    asset,
                    destination_key=destination_key,
                    source_url=source_url,
                    page_url=page_url,
                    page_title=page_title,
                    filename=safe_filename,
                )
                session.add(asset)
                asset.tags = self._merge_tags(session, [], normalized_names)
                root.health = "online"
                session.commit()
                return {
                    "asset_id": asset.id,
                    "status": "saved",
                    "destination": destination_key,
                    "asset_url": f"/api/assets/{asset.id}",
                }, None
            except Exception:
                session.rollback()
                if created_file:
                    final_path.unlink(missing_ok=True)
                raise
            finally:
                if temporary_path is not None:
                    temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _record_origin(
        asset: Asset,
        *,
        destination_key: str,
        source_url: str,
        page_url: str,
        page_title: str,
        filename: str,
    ) -> None:
        if any(
            origin.source_url == source_url
            and origin.page_url == page_url
            and origin.destination == destination_key
            for origin in asset.origins
        ):
            return
        asset.origins.append(
            AssetOrigin(
                source_url=source_url,
                page_url=page_url,
                page_title=page_title,
                original_filename=filename,
                destination=destination_key,
            )
        )

    @staticmethod
    def _merge_tags(
        session: Session, existing: Sequence[Tag], normalized_names: Sequence[str]
    ) -> list[Tag]:
        all_names = sorted({tag.name for tag in existing} | set(normalized_names))
        if not all_names:
            return []
        tags_by_name = {
            tag.name: tag
            for tag in session.scalars(select(Tag).where(Tag.name.in_(all_names))).all()
        }
        for name in all_names:
            if name not in tags_by_name:
                tag = Tag(name=name)
                session.add(tag)
                session.flush()
                tags_by_name[name] = tag
        return [tags_by_name[name] for name in all_names]

    def list_curated_channels(self) -> list[dict[str, Any]]:
        with Session(self.engine) as session:
            channels = session.scalars(
                select(CuratedChannel)
                .options(selectinload(CuratedChannel.items))
                .order_by(CuratedChannel.name)
            ).all()
            return [self._serialize_curated_channel(channel) for channel in channels]

    def get_curated_channel(self, channel_id: str) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            channel = session.scalar(
                select(CuratedChannel)
                .where(CuratedChannel.id == channel_id)
                .options(selectinload(CuratedChannel.items))
            )
            return (
                self._serialize_curated_channel(channel)
                if channel is not None
                else None
            )

    def create_curated_channel(
        self, name: str, description: str = ""
    ) -> dict[str, Any]:
        with Session(self.engine) as session:
            channel = CuratedChannel(name=name.strip(), description=description.strip())
            session.add(channel)
            session.commit()
            return self._serialize_curated_channel(channel)

    def update_curated_channel(
        self, channel_id: str, updates: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            channel = session.scalar(
                select(CuratedChannel)
                .where(CuratedChannel.id == channel_id)
                .options(selectinload(CuratedChannel.items))
            )
            if channel is None:
                return None
            if "name" in updates:
                channel.name = str(updates["name"]).strip()
            if "description" in updates:
                channel.description = str(updates["description"] or "").strip()
            session.commit()
            return self._serialize_curated_channel(channel)

    def delete_curated_channel(self, channel_id: str) -> bool:
        with Session(self.engine) as session:
            channel = session.get(CuratedChannel, channel_id)
            if channel is None:
                return False
            session.delete(channel)
            session.commit()
            return True

    @staticmethod
    def _serialize_curated_channel(channel: CuratedChannel) -> dict[str, Any]:
        return {
            "id": channel.id,
            "name": channel.name,
            "description": channel.description,
            "item_count": len(channel.items),
            "created_at": channel.created_at.isoformat(),
        }

    def add_curated_channel_item(
        self, channel_id: str, asset_id: str, item_status: str
    ) -> tuple[dict[str, Any] | None, str | None]:
        with Session(self.engine) as session:
            channel = session.get(CuratedChannel, channel_id)
            asset = session.scalar(
                select(Asset)
                .where(Asset.id == asset_id)
                .options(
                    selectinload(Asset.files).selectinload(AssetFile.root),
                    selectinload(Asset.editorial),
                    selectinload(Asset.tags),
                    selectinload(Asset.origins),
                )
            )
            if channel is None or asset is None:
                return None, "not_found"
            existing = session.scalar(
                select(CuratedChannelItem).where(
                    CuratedChannelItem.channel_id == channel_id,
                    CuratedChannelItem.asset_id == asset_id,
                )
            )
            if existing is not None:
                return None, "conflict"
            last_position = session.scalar(
                select(func.max(CuratedChannelItem.position)).where(
                    CuratedChannelItem.channel_id == channel_id
                )
            )
            item = CuratedChannelItem(
                channel=channel,
                asset=asset,
                position=int(last_position if last_position is not None else -1) + 1,
                status=item_status,
            )
            session.add(item)
            try:
                session.commit()
            except IntegrityError:
                session.rollback()
                return None, "conflict"
            return self._serialize_curated_item(item), None

    def list_curated_channel_items(
        self, channel_id: str
    ) -> tuple[list[dict[str, Any]] | None, int]:
        with Session(self.engine) as session:
            if session.get(CuratedChannel, channel_id) is None:
                return None, 0
            items = session.scalars(self._curated_item_statement(channel_id)).all()
            return [self._serialize_curated_item(item) for item in items], len(items)

    def update_curated_channel_item(
        self, channel_id: str, asset_id: str, updates: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            items = session.scalars(self._curated_item_statement(channel_id)).all()
            item = next((item for item in items if item.asset_id == asset_id), None)
            if item is None:
                return None
            if "status" in updates:
                item.status = str(updates["status"])
            if "position" in updates:
                items.remove(item)
                requested = min(int(updates["position"]), len(items))
                items.insert(requested, item)
                for position, ordered_item in enumerate(items):
                    ordered_item.position = position
            session.commit()
            return self._serialize_curated_item(item)

    def delete_curated_channel_item(self, channel_id: str, asset_id: str) -> bool:
        with Session(self.engine) as session:
            items = session.scalars(self._curated_item_statement(channel_id)).all()
            item = next((item for item in items if item.asset_id == asset_id), None)
            if item is None:
                return False
            session.delete(item)
            remaining = [candidate for candidate in items if candidate is not item]
            for position, ordered_item in enumerate(remaining):
                ordered_item.position = position
            session.commit()
            return True

    @staticmethod
    def _curated_item_statement(channel_id: str):
        return (
            select(CuratedChannelItem)
            .where(CuratedChannelItem.channel_id == channel_id)
            .options(
                selectinload(CuratedChannelItem.asset)
                .selectinload(Asset.files)
                .selectinload(AssetFile.root),
                selectinload(CuratedChannelItem.asset).selectinload(Asset.editorial),
                selectinload(CuratedChannelItem.asset).selectinload(Asset.tags),
                selectinload(CuratedChannelItem.asset).selectinload(Asset.origins),
            )
            .order_by(CuratedChannelItem.position)
        )

    def _serialize_curated_item(
        self, item: CuratedChannelItem
    ) -> dict[str, Any]:
        return {
            "asset_id": item.asset_id,
            "position": item.position,
            "status": item.status,
            "asset": self._serialize_asset(item.asset),
        }

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

    def queue_audio_extraction(
        self, asset_id: str, request: Mapping[str, Any]
    ) -> tuple[str | None, str | None]:
        source = self.resolve_asset_file(asset_id)
        with Session(self.engine) as session:
            asset = session.get(Asset, asset_id)
            if asset is None or source is None:
                return None, "not_found"
            if asset.media_type not in {"video", "audio"}:
                return None, "wrong_type"
            recipe = {
                "start_ms": int(request.get("start_ms", 0)),
                "end_ms": request.get("end_ms"),
                "format": str(request.get("format", "m4a")),
                "bitrate_kbps": int(request.get("bitrate_kbps", 256)),
            }
            encoded_recipe = json.dumps(recipe, sort_keys=True, separators=(",", ":"))
            fingerprint = hashlib.sha256(encoded_recipe.encode()).hexdigest()
            existing = session.scalar(
                select(Derivative).where(
                    Derivative.source_asset_id == asset_id,
                    Derivative.kind == "audio_extract",
                    Derivative.recipe_fingerprint == fingerprint,
                )
            )
            if existing is not None:
                return None, "conflict"
            extension = {"m4a": "m4a", "opus": "opus", "flac": "flac"}[
                recipe["format"]
            ]
            derivative = Derivative(
                source_asset_id=asset_id,
                kind="audio_extract",
                status="pending",
                relative_path=f"audio/{asset_id}/{fingerprint}.{extension}",
                recipe_fingerprint=fingerprint,
                recipe=recipe,
            )
            session.add(derivative)
            session.flush()
            job = Job(
                kind="audio_extraction",
                status="queued",
                result={
                    "request": dict(request),
                    "derivative_id": derivative.id,
                    "source_asset_id": asset_id,
                },
            )
            session.add(job)
            session.commit()
            return job.id, None

    def run_queued_audio_extraction(self, job_id: str) -> None:
        with Session(self.engine) as session:
            job = session.get(Job, job_id)
            if job is None or job.kind != "audio_extraction":
                return
            job.status = "running"
            job.attempt_count += 1
            details = dict(job.result or {})
            derivative = session.get(Derivative, details.get("derivative_id"))
            if derivative is None:
                job.status = "failed"
                job.result = {**details, "stage": "catalog", "retryable": False}
                session.commit()
                return
            derivative.status = "pending"
            request = dict(details.get("request") or {})
            source_asset_id = derivative.source_asset_id
            relative_path = derivative.relative_path
            recipe = dict(derivative.recipe)
            session.commit()

        source = self.resolve_asset_file(source_asset_id)
        if source is None:
            self._fail_audio_extraction(job_id, "source", retryable=True)
            return
        metadata = {
            "title": str(request.get("title", "")),
            "artist": str(request.get("artist", "")),
            "album": str(request.get("release", "")),
            "date": str(request.get("year", "")),
            "track": str(request.get("track_number", "")),
            "genre": str(request.get("genre", "")),
        }
        try:
            probe = self.audio_extractor.extract(
                source=source,
                relative_path=relative_path,
                recipe=recipe,
                metadata=metadata,
            )
        except AudioExtractionError:
            self._fail_audio_extraction(job_id, "extract", retryable=True)
            return

        with Session(self.engine) as session:
            job = session.get(Job, job_id)
            derivative = session.get(Derivative, details["derivative_id"])
            if job is None or derivative is None:
                return
            artist = self._find_or_create_artist(session, request.get("artist"))
            release = self._find_or_create_release(
                session,
                request.get("release"),
                artist,
                request.get("year"),
            )
            track = Track(
                derivative=derivative,
                source_asset_id=source_asset_id,
                artist=artist,
                release=release,
                title=str(request["title"]).strip(),
                track_number=request.get("track_number"),
                genre=str(request.get("genre", "")).strip(),
                start_ms=int(recipe["start_ms"]),
                end_ms=recipe.get("end_ms"),
            )
            session.add(track)
            track.tags = self._find_or_create_tags(session, request.get("tags", []))
            derivative.status = "active"
            derivative.size = probe.size
            derivative.duration_ms = probe.duration_ms
            derivative.codec = probe.codec
            derivative.sample_rate = probe.sample_rate
            derivative.channels = probe.channels
            derivative.tool_version = probe.tool_version
            derivative.activated_at = datetime.now(UTC)
            session.flush()
            job.status = "completed"
            job.result = {
                **details,
                "track_id": track.id,
                "relative_path": derivative.relative_path,
            }
            session.commit()

    def _fail_audio_extraction(
        self, job_id: str, stage: str, *, retryable: bool
    ) -> None:
        with Session(self.engine) as session:
            job = session.get(Job, job_id)
            if job is None:
                return
            details = dict(job.result or {})
            derivative = session.get(Derivative, details.get("derivative_id"))
            if derivative is not None:
                derivative.status = "failed"
            job.status = "failed"
            job.result = {
                **details,
                "stage": stage,
                "retryable": retryable,
                "error": "Audio extraction failed",
            }
            session.commit()

    def retry_job(self, job_id: str) -> tuple[bool, str | None]:
        with Session(self.engine) as session:
            job = session.get(Job, job_id)
            if job is None:
                return False, "not_found"
            if job.kind != "audio_extraction" or job.status != "failed":
                return False, "conflict"
            if not (job.result or {}).get("retryable"):
                return False, "conflict"
            job.status = "queued"
            session.commit()
            return True, None

    def recover_incomplete_audio_jobs(self) -> list[str]:
        with Session(self.engine) as session:
            jobs = session.scalars(
                select(Job)
                .where(
                    Job.kind == "audio_extraction",
                    Job.status.in_(("queued", "running")),
                )
                .order_by(Job.created_at)
            ).all()
            for job in jobs:
                job.status = "queued"
            session.commit()
            return [job.id for job in jobs]

    def list_tracks(
        self,
        *,
        query: str | None = None,
        artist: str | None = None,
        release: str | None = None,
        tag: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        with Session(self.engine) as session:
            statement = (
                select(Track)
                .join(Track.derivative)
                .where(Derivative.status == "active")
                .options(*self._track_load_options())
            )
            if query:
                statement = statement.outerjoin(Track.artist).outerjoin(Track.release)
                pattern = f"%{query}%"
                statement = statement.where(
                    or_(
                        Track.title.ilike(pattern),
                        Artist.name.ilike(pattern),
                        Release.title.ilike(pattern),
                    )
                )
            if artist:
                statement = statement.join(Track.artist).where(
                    Artist.normalized_name == self._normalize_music_name(artist)
                )
            if release:
                statement = statement.join(Track.release).where(
                    Release.normalized_title == self._normalize_music_name(release)
                )
            if tag:
                statement = statement.join(Track.tags).where(
                    Tag.name == self._normalize_tag(tag)
                )
            total = session.scalar(
                select(func.count()).select_from(statement.order_by(None).subquery())
            )
            tracks = session.scalars(
                statement.order_by(Track.created_at.desc()).limit(limit).offset(offset)
            ).unique().all()
            return [self._serialize_track(track) for track in tracks], int(total or 0)

    def get_track(self, track_id: str) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            track = session.scalar(
                select(Track)
                .where(Track.id == track_id)
                .options(*self._track_load_options())
            )
            return self._serialize_track(track) if track is not None else None

    def update_track(
        self, track_id: str, updates: Mapping[str, Any]
    ) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            track = session.scalar(
                select(Track)
                .where(Track.id == track_id)
                .options(*self._track_load_options())
            )
            if track is None:
                return None
            if "title" in updates:
                track.title = str(updates["title"]).strip()
            if "artist" in updates:
                track.artist = self._find_or_create_artist(session, updates["artist"])
            if "release" in updates or "year" in updates or "artist" in updates:
                release_title = updates.get(
                    "release", track.release.title if track.release else None
                )
                release_year = updates.get(
                    "year", track.release.year if track.release else None
                )
                track.release = self._find_or_create_release(
                    session, release_title, track.artist, release_year
                )
                if "year" in updates and track.release is not None:
                    track.release.year = updates["year"]
            for field in ("track_number", "genre"):
                if field in updates:
                    setattr(track, field, updates[field] or ("" if field == "genre" else None))
            if "tags" in updates:
                track.tags = self._find_or_create_tags(session, updates["tags"] or [])
            session.commit()
            return self._serialize_track(track)

    def delete_track(self, track_id: str) -> bool:
        with Session(self.engine) as session:
            track = session.scalar(
                select(Track)
                .where(Track.id == track_id)
                .options(selectinload(Track.derivative))
            )
            if track is None:
                return False
            derivative = track.derivative
            self.audio_extractor.delete(derivative.relative_path)
            session.delete(derivative)
            session.commit()
            return True

    def resolve_track_file(self, track_id: str) -> Path | None:
        with Session(self.engine) as session:
            derivative = session.scalar(
                select(Derivative)
                .join(Track, Track.derivative_id == Derivative.id)
                .where(Track.id == track_id, Derivative.status == "active")
            )
            if derivative is None:
                return None
            return self.audio_extractor.resolve(derivative.relative_path)

    def list_artists(self) -> list[dict[str, Any]]:
        with Session(self.engine) as session:
            artists = session.scalars(
                select(Artist)
                .options(selectinload(Artist.tracks))
                .order_by(Artist.normalized_name)
            ).all()
            return [
                {"id": item.id, "name": item.name, "track_count": len(item.tracks)}
                for item in artists
                if item.tracks
            ]

    def list_releases(self) -> list[dict[str, Any]]:
        with Session(self.engine) as session:
            releases = session.scalars(
                select(Release)
                .options(selectinload(Release.artist), selectinload(Release.tracks))
                .order_by(Release.normalized_title)
            ).all()
            return [
                {
                    "id": item.id,
                    "title": item.title,
                    "year": item.year,
                    "artist": self._serialize_artist(item.artist),
                    "track_count": len(item.tracks),
                }
                for item in releases
                if item.tracks
            ]

    @staticmethod
    def _track_load_options():
        return (
            selectinload(Track.derivative),
            selectinload(Track.source_asset)
            .selectinload(Asset.files)
            .selectinload(AssetFile.root),
            selectinload(Track.artist),
            selectinload(Track.release).selectinload(Release.artist),
            selectinload(Track.tags),
        )

    def _serialize_track(self, track: Track) -> dict[str, Any]:
        derivative = track.derivative
        return {
            "id": track.id,
            "title": track.title,
            "artist": self._serialize_artist(track.artist),
            "release": (
                {
                    "id": track.release.id,
                    "title": track.release.title,
                    "year": track.release.year,
                }
                if track.release is not None
                else None
            ),
            "track_number": track.track_number,
            "genre": track.genre,
            "tags": sorted(tag.name for tag in track.tags),
            "source_asset": {
                "id": track.source_asset.id,
                "title": track.source_asset.title,
            },
            "start_ms": track.start_ms,
            "end_ms": track.end_ms,
            "format": str(derivative.recipe["format"]),
            "codec": derivative.codec,
            "size": derivative.size,
            "duration_ms": derivative.duration_ms,
            "sample_rate": derivative.sample_rate,
            "channels": derivative.channels,
            "relative_path": derivative.relative_path,
            "stream_url": f"/api/music/tracks/{track.id}/stream",
            "artwork_url": (
                f"/api/assets/{track.source_asset.id}/thumbnail"
                if self._resolve_thumbnail_from_files(track.source_asset.files) is not None
                else None
            ),
            "created_at": track.created_at.isoformat(),
        }

    @staticmethod
    def _serialize_artist(artist: Artist | None) -> dict[str, Any] | None:
        return {"id": artist.id, "name": artist.name} if artist is not None else None

    @staticmethod
    def _normalize_music_name(value: Any) -> str:
        return " ".join(str(value or "").strip().casefold().split())

    def _find_or_create_artist(self, session: Session, value: Any) -> Artist | None:
        name = " ".join(str(value or "").strip().split())
        if not name:
            return None
        normalized = self._normalize_music_name(name)
        artist = session.scalar(
            select(Artist).where(Artist.normalized_name == normalized)
        )
        if artist is None:
            artist = Artist(name=name, normalized_name=normalized)
            session.add(artist)
            session.flush()
        return artist

    def _find_or_create_release(
        self,
        session: Session,
        value: Any,
        artist: Artist | None,
        year: Any,
    ) -> Release | None:
        title = " ".join(str(value or "").strip().split())
        if not title:
            return None
        normalized = self._normalize_music_name(title)
        statement = select(Release).where(
            Release.normalized_title == normalized,
            Release.artist_id == (artist.id if artist else None),
        )
        release = session.scalar(statement)
        if release is None:
            release = Release(
                title=title,
                normalized_title=normalized,
                artist=artist,
                year=year,
            )
            session.add(release)
            session.flush()
        elif year is not None:
            release.year = year
        return release

    def _find_or_create_tags(self, session: Session, values: Any) -> list[Tag]:
        names = sorted(
            {
                normalized
                for value in values
                if (normalized := self._normalize_tag(str(value)))
            }
        )
        existing = {
            tag.name: tag
            for tag in session.scalars(select(Tag).where(Tag.name.in_(names))).all()
        }
        for name in names:
            if name not in existing:
                existing[name] = Tag(name=name)
                session.add(existing[name])
        session.flush()
        return [existing[name] for name in names]

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
                    "attempt_count": job.attempt_count,
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
