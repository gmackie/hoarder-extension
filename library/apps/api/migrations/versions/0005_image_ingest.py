"""Add managed image roots and browser provenance.

Revision ID: 0005
Revises: 0004
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0005"
down_revision: str | Sequence[str] | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "storage_roots",
        sa.Column("writable", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "storage_roots",
        sa.Column(
            "accepts_images", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )
    op.create_table(
        "asset_origins",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("source_url", sa.String(length=4096), nullable=False),
        sa.Column("page_url", sa.String(length=4096), nullable=False),
        sa.Column("page_title", sa.String(length=1024), nullable=False),
        sa.Column("original_filename", sa.String(length=1024), nullable=False),
        sa.Column("destination", sa.String(length=80), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("asset_id", "source_url", "page_url", "destination"),
    )
    op.create_index("ix_asset_origins_asset_id", "asset_origins", ["asset_id"])


def downgrade() -> None:
    op.drop_table("asset_origins")
    op.drop_column("storage_roots", "accepts_images")
    op.drop_column("storage_roots", "writable")
