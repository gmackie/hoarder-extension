"""Use 64-bit storage for file sizes and nanosecond mtimes.

Revision ID: 0002
Revises: 0001
"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0002"
down_revision: str | Sequence[str] | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "asset_files", "size", existing_type=sa.Integer(), type_=sa.BigInteger()
    )
    op.alter_column(
        "asset_files", "mtime_ns", existing_type=sa.Integer(), type_=sa.BigInteger()
    )


def downgrade() -> None:
    op.alter_column(
        "asset_files", "mtime_ns", existing_type=sa.BigInteger(), type_=sa.Integer()
    )
    op.alter_column(
        "asset_files", "size", existing_type=sa.BigInteger(), type_=sa.Integer()
    )
