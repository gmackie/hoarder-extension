from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class StorageRoot(Base):
    __tablename__ = "storage_roots"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True)
    label: Mapped[str] = mapped_column(String(160))
    path: Mapped[str] = mapped_column(String(2048))
    sentinel: Mapped[str | None] = mapped_column(String(255), nullable=True)
    health: Mapped[str] = mapped_column(String(24), default="unknown")
    writable: Mapped[bool] = mapped_column(Boolean, default=False)
    accepts_images: Mapped[bool] = mapped_column(Boolean, default=False)
    files: Mapped[list["AssetFile"]] = relationship(back_populates="root")


class Asset(Base):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    title: Mapped[str] = mapped_column(String(1024))
    media_type: Mapped[str] = mapped_column(String(24), index=True)
    status: Mapped[str] = mapped_column(String(24), default="available")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    files: Mapped[list["AssetFile"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )
    editorial: Mapped["AssetEditorial | None"] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )
    tags: Mapped[list["Tag"]] = relationship(
        secondary="asset_tags", back_populates="assets"
    )
    channel_items: Mapped[list["CuratedChannelItem"]] = relationship(
        back_populates="asset", cascade="all, delete-orphan"
    )
    origins: Mapped[list["AssetOrigin"]] = relationship(
        back_populates="asset",
        cascade="all, delete-orphan",
        order_by="AssetOrigin.captured_at",
    )


class AssetFile(Base):
    __tablename__ = "asset_files"
    __table_args__ = (UniqueConstraint("root_id", "relative_path"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    root_id: Mapped[int] = mapped_column(ForeignKey("storage_roots.id"), index=True)
    relative_path: Mapped[str] = mapped_column(String(2048))
    size: Mapped[int] = mapped_column(BigInteger)
    mtime_ns: Mapped[int] = mapped_column(BigInteger)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    asset: Mapped[Asset] = relationship(back_populates="files")
    root: Mapped[StorageRoot] = relationship(back_populates="files")


class AssetOrigin(Base):
    __tablename__ = "asset_origins"
    __table_args__ = (
        UniqueConstraint("asset_id", "source_url", "page_url", "destination"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    source_url: Mapped[str] = mapped_column(String(4096), default="")
    page_url: Mapped[str] = mapped_column(String(4096), default="")
    page_title: Mapped[str] = mapped_column(String(1024), default="")
    original_filename: Mapped[str] = mapped_column(String(1024), default="")
    destination: Mapped[str] = mapped_column(String(80))
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    asset: Mapped[Asset] = relationship(back_populates="origins")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    kind: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(24), index=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )


class AssetEditorial(Base):
    __tablename__ = "asset_editorial"
    __table_args__ = (
        CheckConstraint("rating IS NULL OR rating BETWEEN 1 AND 5"),
        CheckConstraint(
            "workflow_state IN ('inbox', 'candidate', 'reviewed', 'selected', 'archived')"
        ),
    )

    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True
    )
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    workflow_state: Mapped[str] = mapped_column(String(24), default="inbox")
    notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    asset: Mapped[Asset] = relationship(back_populates="editorial")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    assets: Mapped[list[Asset]] = relationship(
        secondary="asset_tags", back_populates="tags"
    )
    tracks: Mapped[list["Track"]] = relationship(
        secondary="track_tags", back_populates="tags"
    )


class AssetTag(Base):
    __tablename__ = "asset_tags"

    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class Derivative(Base):
    __tablename__ = "derivatives"
    __table_args__ = (
        UniqueConstraint("source_asset_id", "kind", "recipe_fingerprint"),
        CheckConstraint("status IN ('pending', 'active', 'failed')"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    source_asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(24), index=True)
    relative_path: Mapped[str] = mapped_column(String(2048))
    recipe_fingerprint: Mapped[str] = mapped_column(String(64))
    recipe: Mapped[dict] = mapped_column(JSON)
    tool_version: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    codec: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sample_rate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    channels: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    activated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    source_asset: Mapped[Asset] = relationship()
    track: Mapped["Track | None"] = relationship(
        back_populates="derivative", cascade="all, delete-orphan"
    )


class Artist(Base):
    __tablename__ = "artists"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    name: Mapped[str] = mapped_column(String(300))
    normalized_name: Mapped[str] = mapped_column(String(300), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    tracks: Mapped[list["Track"]] = relationship(back_populates="artist")
    releases: Mapped[list["Release"]] = relationship(back_populates="artist")


class Release(Base):
    __tablename__ = "releases"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    title: Mapped[str] = mapped_column(String(500))
    normalized_title: Mapped[str] = mapped_column(String(500), index=True)
    artist_id: Mapped[str | None] = mapped_column(
        ForeignKey("artists.id", ondelete="SET NULL"), nullable=True, index=True
    )
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    artist: Mapped[Artist | None] = relationship(back_populates="releases")
    tracks: Mapped[list["Track"]] = relationship(back_populates="release")


class Track(Base):
    __tablename__ = "tracks"
    __table_args__ = (
        CheckConstraint("start_ms >= 0"),
        CheckConstraint("end_ms IS NULL OR end_ms > start_ms"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    derivative_id: Mapped[str] = mapped_column(
        ForeignKey("derivatives.id", ondelete="CASCADE"), unique=True, index=True
    )
    source_asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    artist_id: Mapped[str | None] = mapped_column(
        ForeignKey("artists.id", ondelete="SET NULL"), nullable=True, index=True
    )
    release_id: Mapped[str | None] = mapped_column(
        ForeignKey("releases.id", ondelete="SET NULL"), nullable=True, index=True
    )
    title: Mapped[str] = mapped_column(String(1024), index=True)
    track_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    genre: Mapped[str] = mapped_column(String(200), default="")
    start_ms: Mapped[int] = mapped_column(BigInteger, default=0)
    end_ms: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    derivative: Mapped[Derivative] = relationship(back_populates="track")
    source_asset: Mapped[Asset] = relationship()
    artist: Mapped[Artist | None] = relationship(back_populates="tracks")
    release: Mapped[Release | None] = relationship(back_populates="tracks")
    tags: Mapped[list[Tag]] = relationship(
        secondary="track_tags", back_populates="tracks"
    )


class TrackTag(Base):
    __tablename__ = "track_tags"

    track_id: Mapped[str] = mapped_column(
        ForeignKey("tracks.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True
    )


class CuratedChannel(Base):
    __tablename__ = "curated_channels"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
    )
    items: Mapped[list["CuratedChannelItem"]] = relationship(
        back_populates="channel",
        cascade="all, delete-orphan",
        order_by="CuratedChannelItem.position",
    )


class CuratedChannelItem(Base):
    __tablename__ = "curated_channel_items"
    __table_args__ = (
        UniqueConstraint("channel_id", "asset_id"),
        CheckConstraint(
            "status IN ('candidate', 'reviewed', 'selected', 'used', 'rejected')"
        ),
        CheckConstraint("position >= 0"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[str] = mapped_column(
        ForeignKey("curated_channels.id", ondelete="CASCADE"), index=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(24), default="candidate")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
    channel: Mapped[CuratedChannel] = relationship(back_populates="items")
    asset: Mapped[Asset] = relationship(back_populates="channel_items")
