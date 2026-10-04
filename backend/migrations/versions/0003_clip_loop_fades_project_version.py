"""clip loop/fades/reverse/cents, project version + markers

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clips", sa.Column("loop_beats", sa.Float(), nullable=True))
    op.add_column("clips", sa.Column("fade_in_sec", sa.Float(), nullable=False, server_default=sa.text("0")))
    op.add_column("clips", sa.Column("fade_out_sec", sa.Float(), nullable=False, server_default=sa.text("0")))
    op.add_column("clips", sa.Column("reverse", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("clips", sa.Column("cents", sa.Integer(), nullable=False, server_default=sa.text("0")))
    op.add_column("projects", sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")))
    op.add_column(
        "projects",
        sa.Column("markers", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
    )


def downgrade() -> None:
    op.drop_column("projects", "markers")
    op.drop_column("projects", "version")
    for col in ("cents", "reverse", "fade_out_sec", "fade_in_sec", "loop_beats"):
        op.drop_column("clips", col)
