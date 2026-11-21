"""Add generated audio derivatives and the music catalog.

Revision ID: 0004
Revises: 0003
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "jobs",
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_table(
        "artists",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("normalized_name", sa.String(length=300), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_artists_normalized_name", "artists", ["normalized_name"])
    op.create_table(
        "releases",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("normalized_title", sa.String(length=500), nullable=False),
        sa.Column(
            "artist_id",
            sa.String(length=36),
            sa.ForeignKey("artists.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("year", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_releases_normalized_title", "releases", ["normalized_title"])
    op.create_index("ix_releases_artist_id", "releases", ["artist_id"])
    op.create_table(
        "derivatives",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "source_asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=40), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("relative_path", sa.String(length=2048), nullable=False),
        sa.Column("recipe_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("recipe", sa.JSON(), nullable=False),
        sa.Column("tool_version", sa.String(length=255), nullable=True),
        sa.Column("size", sa.BigInteger(), nullable=True),
        sa.Column("duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("codec", sa.String(length=80), nullable=True),
        sa.Column("sample_rate", sa.Integer(), nullable=True),
        sa.Column("channels", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'active', 'failed')"),
        sa.UniqueConstraint("source_asset_id", "kind", "recipe_fingerprint"),
    )
    op.create_index("ix_derivatives_source_asset_id", "derivatives", ["source_asset_id"])
    op.create_index("ix_derivatives_kind", "derivatives", ["kind"])
    op.create_index("ix_derivatives_status", "derivatives", ["status"])
    op.create_table(
        "tracks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "derivative_id",
            sa.String(length=36),
            sa.ForeignKey("derivatives.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column(
            "source_asset_id",
            sa.String(length=36),
            sa.ForeignKey("assets.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "artist_id",
            sa.String(length=36),
            sa.ForeignKey("artists.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "release_id",
            sa.String(length=36),
            sa.ForeignKey("releases.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("title", sa.String(length=1024), nullable=False),
        sa.Column("track_number", sa.Integer(), nullable=True),
        sa.Column("genre", sa.String(length=200), nullable=False),
        sa.Column("start_ms", sa.BigInteger(), nullable=False),
        sa.Column("end_ms", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("start_ms >= 0"),
        sa.CheckConstraint("end_ms IS NULL OR end_ms > start_ms"),
    )
    op.create_index("ix_tracks_derivative_id", "tracks", ["derivative_id"])
    op.create_index("ix_tracks_source_asset_id", "tracks", ["source_asset_id"])
    op.create_index("ix_tracks_artist_id", "tracks", ["artist_id"])
    op.create_index("ix_tracks_release_id", "tracks", ["release_id"])
    op.create_index("ix_tracks_title", "tracks", ["title"])
    op.create_table(
        "track_tags",
        sa.Column(
            "track_id",
            sa.String(length=36),
            sa.ForeignKey("tracks.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "tag_id",
            sa.Integer(),
            sa.ForeignKey("tags.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )


def downgrade() -> None:
    op.drop_table("track_tags")
    op.drop_table("tracks")
    op.drop_table("derivatives")
    op.drop_table("releases")
    op.drop_table("artists")
    op.drop_column("jobs", "attempt_count")
