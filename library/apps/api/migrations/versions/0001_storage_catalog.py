"""Create the storage-first catalog.

Revision ID: 0001
Revises:
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "storage_roots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=80), nullable=False, unique=True),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("path", sa.String(length=2048), nullable=False),
        sa.Column("sentinel", sa.String(length=255), nullable=True),
        sa.Column("health", sa.String(length=24), nullable=False),
    )
    op.create_table(
        "assets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=1024), nullable=False),
        sa.Column("media_type", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_assets_media_type", "assets", ["media_type"])
    op.create_table(
        "asset_files",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("asset_id", sa.String(length=36), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("root_id", sa.Integer(), sa.ForeignKey("storage_roots.id"), nullable=False),
        sa.Column("relative_path", sa.String(length=2048), nullable=False),
        sa.Column("size", sa.BigInteger(), nullable=False),
        sa.Column("mtime_ns", sa.BigInteger(), nullable=False),
        sa.Column("fingerprint", sa.String(length=64), nullable=False),
        sa.UniqueConstraint("root_id", "relative_path"),
    )
    op.create_index("ix_asset_files_asset_id", "asset_files", ["asset_id"])
    op.create_index("ix_asset_files_root_id", "asset_files", ["root_id"])
    op.create_index("ix_asset_files_fingerprint", "asset_files", ["fingerprint"])
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("kind", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_jobs_kind", "jobs", ["kind"])
    op.create_index("ix_jobs_status", "jobs", ["status"])


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("asset_files")
    op.drop_table("assets")
    op.drop_table("storage_roots")
