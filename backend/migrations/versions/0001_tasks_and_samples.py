"""tasks and samples

Revision ID: 0001
Revises:
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("model", sa.String(64), nullable=False),
        sa.Column("recover", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("recovery_model", sa.String(32), nullable=False),
        sa.Column("source_name", sa.Text()),
        sa.Column("file_path", sa.Text()),
        sa.Column("meta", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        *_timestamps(),
    )
    op.create_index("ix_tasks_status", "tasks", ["status"])
    op.create_index("ix_tasks_created_at", "tasks", ["created_at"])

    op.create_table(
        "samples",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("file_path", sa.Text(), nullable=False),
        sa.Column(
            "source_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
        ),
        sa.Column("source_track", sa.Text()),
        sa.Column("source_variant", sa.String(16)),
        sa.Column("start_sec", sa.Float()),
        sa.Column("end_sec", sa.Float()),
        sa.Column("duration_sec", sa.Float(), nullable=False),
        sa.Column("sample_rate", sa.Integer(), nullable=False),
        sa.Column("channels", sa.Integer(), nullable=False),
        sa.Column("bpm_detected", sa.Float()),
        sa.Column("bpm_override", sa.Float()),
        sa.Column("key_detected", sa.String(16)),
        sa.Column("key_override", sa.String(16)),
        sa.Column("tags", postgresql.ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("analysis_status", sa.String(16), nullable=False, server_default=sa.text("'pending'")),
        *_timestamps(),
    )
    op.create_index("ix_samples_created_at", "samples", ["created_at"])
    op.create_index("ix_samples_tags", "samples", ["tags"], postgresql_using="gin")


def downgrade() -> None:
    op.drop_table("samples")
    op.drop_table("tasks")
