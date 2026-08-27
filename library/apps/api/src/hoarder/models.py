from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    String,
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
