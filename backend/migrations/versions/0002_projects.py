"""projects, tracks and clips

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "projects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("bpm", sa.Float(), nullable=False, server_default=sa.text("120")),
        sa.Column("beats_per_bar", sa.Integer(), nullable=False, server_default=sa.text("4")),
        sa.Column("loop_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("loop_start_beat", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("loop_end_beat", sa.Float(), nullable=False, server_default=sa.text("16")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_projects_updated_at", "projects", ["updated_at"])

    op.create_table(
        "project_tracks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("volume", sa.Float(), nullable=False, server_default=sa.text("1")),
        sa.Column("pan", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("muted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("soloed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.create_index("ix_project_tracks_project_id", "project_tracks", ["project_id"])

    op.create_table(
        "clips",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "track_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("project_tracks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sample_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("samples.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("start_beat", sa.Float(), nullable=False),
        sa.Column("offset_sec", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column("length_sec", sa.Float(), nullable=False),
        sa.Column("warp", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("semitones", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("gain", sa.Float(), nullable=False, server_default=sa.text("1")),
    )
    op.create_index("ix_clips_track_id", "clips", ["track_id"])
    op.create_index("ix_clips_sample_id", "clips", ["sample_id"])


def downgrade() -> None:
    op.drop_table("clips")
    op.drop_table("project_tracks")
    op.drop_table("projects")
