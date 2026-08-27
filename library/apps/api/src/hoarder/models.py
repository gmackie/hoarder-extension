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


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    kind: Mapped[str] = mapped_column(String(80), index=True)
    status: Mapped[str] = mapped_column(String(24), index=True)
    result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
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


class AssetTag(Base):
    __tablename__ = "asset_tags"

    asset_id: Mapped[str] = mapped_column(
        ForeignKey("assets.id", ondelete="CASCADE"), primary_key=True
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
