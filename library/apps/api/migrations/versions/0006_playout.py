"""Add curated-channel playout configuration and durable screen sessions.

Revision ID: 0006
Revises: 0005
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0006"
down_revision: str | Sequence[str] | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "playout_configurations",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "channel_id",
            sa.String(length=36),
            sa.ForeignKey("curated_channels.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("playback_mode", sa.String(length=24), nullable=False),
        sa.Column("loop", sa.Boolean(), nullable=False),
        sa.Column("image_duration_seconds", sa.Integer(), nullable=False),
        sa.Column("item_statuses", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("playback_mode IN ('ordered', 'shuffle')"),
        sa.CheckConstraint("image_duration_seconds BETWEEN 3 AND 3600"),
    )
    op.create_index(
        "ix_playout_configurations_channel_id",
        "playout_configurations",
        ["channel_id"],
    )
    op.create_table(
        "playout_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "configuration_id",
            sa.String(length=36),
            sa.ForeignKey("playout_configurations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "current_asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("screen_key", sa.String(length=120), nullable=False),
        sa.Column("cycle", sa.Integer(), nullable=False),
        sa.Column("position_ms", sa.BigInteger(), nullable=False),
        sa.Column("paused", sa.Boolean(), nullable=False),
        sa.Column("ended", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("configuration_id", "screen_key"),
        sa.CheckConstraint("cycle >= 0"),
        sa.CheckConstraint("position_ms >= 0"),
    )
    op.create_index(
        "ix_playout_sessions_configuration_id",
        "playout_sessions",
        ["configuration_id"],
    )
    op.create_index(
        "ix_playout_sessions_current_asset_id",
        "playout_sessions",
        ["current_asset_id"],
    )


def downgrade() -> None:
    op.drop_table("playout_sessions")
    op.drop_table("playout_configurations")
