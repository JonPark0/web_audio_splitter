"""
Persistence for separation jobs (replaces the old in-memory `tasks` dict).

Tasks are exchanged as plain dicts shaped like the old in-memory entries —
column fields plus everything in `meta` merged at the top level — so the
pipeline and endpoints didn't need restructuring, only their reads/writes.
"""
import uuid
from typing import Optional

from sqlalchemy import cast, select, update
from sqlalchemy.dialects.postgresql import JSONB

from db import session_scope
from models import Task

COLUMN_FIELDS = {"kind", "status", "model", "recover", "recovery_model", "source_name", "file_path"}

# States a job can only be in while a worker thread is driving it. A backend
# restart kills that thread, so rows left in these states would otherwise
# spin forever on the frontend.
IN_FLIGHT_STATUSES = ("queued", "downloading", "processing", "restoring")


def parse_id(task_id: str) -> Optional[uuid.UUID]:
    try:
        return uuid.UUID(str(task_id))
    except ValueError:
        return None


def _to_dict(task: Task) -> dict:
    data = dict(task.meta or {})
    data.update(
        id=str(task.id),
        kind=task.kind,
        status=task.status,
        model=task.model,
        recover=task.recover,
        recovery_model=task.recovery_model,
        source_name=task.source_name,
        file_path=task.file_path,
        created_at=task.created_at.isoformat() if task.created_at else None,
    )
    return data


def _split(fields: dict) -> tuple[dict, dict]:
    columns = {k: v for k, v in fields.items() if k in COLUMN_FIELDS}
    meta = {k: v for k, v in fields.items() if k not in COLUMN_FIELDS}
    return columns, meta


def create_task(task_id: str, **fields) -> None:
    columns, meta = _split(fields)
    with session_scope() as session:
        session.add(Task(id=uuid.UUID(task_id), meta=meta, **columns))


def get_task(task_id: str) -> Optional[dict]:
    tid = parse_id(task_id)
    if tid is None:
        return None
    with session_scope() as session:
        task = session.get(Task, tid)
        return _to_dict(task) if task else None


def update_task(task_id: str, **fields) -> None:
    columns, meta = _split(fields)
    values = dict(columns)
    if meta:
        # Merge in SQL (jsonb ||) so concurrent writers never clobber each
        # other's keys with a stale read-modify-write.
        values["meta"] = Task.meta.op("||")(cast(meta, JSONB))
    with session_scope() as session:
        session.execute(update(Task).where(Task.id == uuid.UUID(task_id)).values(**values))


def list_tasks(limit: int = 50) -> list[dict]:
    with session_scope() as session:
        rows = session.scalars(select(Task).order_by(Task.created_at.desc()).limit(limit)).all()
        return [_to_dict(t) for t in rows]


def fail_interrupted_tasks() -> int:
    """Mark jobs orphaned by a restart as failed; returns how many."""
    with session_scope() as session:
        result = session.execute(
            update(Task)
            .where(Task.status.in_(IN_FLIGHT_STATUSES))
            .values(
                status="failed",
                meta=Task.meta.op("||")(cast({"error": "Interrupted by a server restart"}, JSONB)),
            )
        )
        return result.rowcount
