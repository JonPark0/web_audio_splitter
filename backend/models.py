"""
ORM models. The schema itself is owned by Alembic (migrations/versions/) —
keep the two in sync when changing either.
"""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from db import Base


class Task(Base):
    """A separation (+ optional recovery) job.

    Fields that vary by job kind or change while it runs — YouTube metadata,
    progress (step/step_index/step_total/current_stem) and the error message —
    live in `meta` rather than as a column each.
    """

    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # "upload" | "youtube"
    status: Mapped[str] = mapped_column(String(32), index=True)
    model: Mapped[str] = mapped_column(String(64))
    recover: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    recovery_model: Mapped[str] = mapped_column(String(32))
    source_name: Mapped[Optional[str]] = mapped_column(Text)
    file_path: Mapped[Optional[str]] = mapped_column(Text)
    meta: Mapped[dict] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Sample(Base):
    """An audio snippet kept in the sample library.

    Its audio is a standalone copy under media/samples/, so it survives the
    source task's media being cleaned up; `source_*` is provenance only.
    BPM and key keep the detected value and the user's override separately —
    beat trackers routinely make octave errors, and the user must be able to
    correct them without losing (or later reverting to) the detected value.
    """

    __tablename__ = "samples"
    __table_args__ = (Index("ix_samples_tags", "tags", postgresql_using="gin"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(Text)
    file_path: Mapped[str] = mapped_column(Text)

    source_task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL")
    )
    source_track: Mapped[Optional[str]] = mapped_column(Text)
    source_variant: Mapped[Optional[str]] = mapped_column(String(16))
    start_sec: Mapped[Optional[float]] = mapped_column(Float)
    end_sec: Mapped[Optional[float]] = mapped_column(Float)

    duration_sec: Mapped[float] = mapped_column(Float)
    sample_rate: Mapped[int] = mapped_column(Integer)
    channels: Mapped[int] = mapped_column(Integer)

    bpm_detected: Mapped[Optional[float]] = mapped_column(Float)
    bpm_override: Mapped[Optional[float]] = mapped_column(Float)
    key_detected: Mapped[Optional[str]] = mapped_column(String(16))
    key_override: Mapped[Optional[str]] = mapped_column(String(16))
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), server_default=text("'{}'"))
    analysis_status: Mapped[str] = mapped_column(String(16), server_default=text("'pending'"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
