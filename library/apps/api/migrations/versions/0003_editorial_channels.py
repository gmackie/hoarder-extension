"""Add durable editorial metadata and curated channels.

Revision ID: 0003
Revises: 0002
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0003"
down_revision: str | Sequence[str] | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "asset_editorial",
        sa.Column(
            "asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("favorite", sa.Boolean(), nullable=False),
        sa.Column("workflow_state", sa.String(length=24), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("rating IS NULL OR rating BETWEEN 1 AND 5"),
        sa.CheckConstraint(
            "workflow_state IN ('inbox', 'candidate', 'reviewed', 'selected', 'archived')"
        ),
    )
    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False, unique=True),
    )
    op.create_table(
        "asset_tags",
        sa.Column(
            "asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer(),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "curated_channels",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "curated_channel_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "channel_id",
            sa.String(length=36),
            sa.ForeignKey("curated_channels.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("channel_id", "asset_id"),
        sa.CheckConstraint(
            "status IN ('candidate', 'reviewed', 'selected', 'used', 'rejected')"
        ),
        sa.CheckConstraint("position >= 0"),
    )
    op.create_index(
        "ix_curated_channel_items_channel_id",
        "curated_channel_items",
        ["channel_id"],
    )
    op.create_index(
        "ix_curated_channel_items_asset_id",
        "curated_channel_items",
        ["asset_id"],
    )


def downgrade() -> None:
    op.drop_table("curated_channel_items")
    op.drop_table("curated_channels")
    op.drop_table("asset_tags")
    op.drop_table("tags")
    op.drop_table("asset_editorial")
