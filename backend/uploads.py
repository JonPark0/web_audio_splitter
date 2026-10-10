"""
Resumable uploads: a file goes up in chunks into a partial file, so an
upload cut off by a locked phone, an app switch or a flaky connection picks
up where it stopped instead of starting over (and a 1 GB file is no longer
one request).

    POST   /uploads                form: filename, size, model, recover, recovery_model
                                   → {upload_id, received: 0, size, chunk_size}
    PUT    /uploads/{id}           multipart: offset, chunk → {received};
                                   409 {received} when offset isn't where the file ends
    GET    /uploads/{id}           → {received, size, task_id} (where to resume)
    POST   /uploads/{id}/complete  → {task_id}: the same checks and job as POST /upload
    DELETE /uploads/{id}           → 204

Bytes and a small JSON meta live in UPLOAD_DIR/partial; sessions untouched
for a day are purged. This module knows nothing about jobs, so it can be
tested without the ML stack: main.py hands it the settings check and the
hook that turns a finished file into a job through configure().
"""
import json
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Optional

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/uploads", tags=["uploads"])

CHUNK_SIZE = 8 * 1024 * 1024
STALE_SECONDS = 24 * 3600

# Set by configure().
_upload_dir: Optional[Path] = None
_max_upload_mb: float = 0
_validate_settings: Optional[Callable] = None
_start_task: Optional[Callable] = None


def configure(upload_dir: Path, max_upload_mb: float, validate_settings: Callable, start_task: Callable) -> None:
    """validate_settings(model, recover, recovery_model) raises HTTPException
    for unknown settings. start_task(task_id, file_path, source_name, model,
    recover, recovery_model) checks a finished file named <task_id><ext> in
    upload_dir and queues its job; a refused file is deleted and the
    HTTPException raised."""
    global _upload_dir, _max_upload_mb, _validate_settings, _start_task
    _upload_dir = Path(upload_dir)
    _max_upload_mb = max_upload_mb
    _validate_settings = validate_settings
    _start_task = start_task


# One lock per upload: a client that resends a chunk while the server is
# still writing the first copy must not get the same bytes appended twice.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock(upload_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(upload_id, threading.Lock())


def _parse_id(upload_id: str) -> str:
    """The canonical id, or 404. Ids become file names, so nothing but a
    UUID gets near the path."""
    try:
        return str(uuid.UUID(upload_id))
    except ValueError:
        raise HTTPException(status_code=404, detail="Upload not found")


def _partial_dir() -> Path:
    return _upload_dir / "partial"


def _paths(upload_id: str) -> tuple[Path, Path]:
    return _partial_dir() / f"{upload_id}.part", _partial_dir() / f"{upload_id}.json"


def _read_meta(upload_id: str) -> dict:
    try:
        return json.loads(_paths(upload_id)[1].read_text())
    except (OSError, ValueError):
        raise HTTPException(status_code=404, detail="Upload not found")


def _write_meta(upload_id: str, meta: dict) -> None:
    path = _paths(upload_id)[1]
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(meta))
    os.replace(tmp, path)


def _received(upload_id: str, meta: dict) -> int:
    """Bytes on disk: the file itself is the record, so a chunk cut off
    halfway through writing still counts for what it wrote."""
    if meta.get("task_id"):
        return meta["size"]
    try:
        return _paths(upload_id)[0].stat().st_size
    except FileNotFoundError:
        return 0


def _forget(upload_id: str) -> None:
    for path in _paths(upload_id):
        path.unlink(missing_ok=True)
    with _locks_guard:
        _locks.pop(upload_id, None)


def _purge_stale() -> None:
    """Drop sessions untouched for a day: abandoned uploads, and finished
    ones kept so a repeated complete returns the same job."""
    newest: dict[str, float] = {}
    for path in _partial_dir().iterdir():
        try:
            mtime = path.stat().st_mtime
        except FileNotFoundError:
            continue
        upload_id = path.name.split(".")[0]
        newest[upload_id] = max(newest.get(upload_id, 0), mtime)
    cutoff = time.time() - STALE_SECONDS
    for upload_id, mtime in newest.items():
        if mtime < cutoff:
            _forget(upload_id)


def _size_of(f) -> int:
    f.seek(0, os.SEEK_END)
    size = f.tell()
    f.seek(0)
    return size


def _out_of_step(received: int, size: int) -> JSONResponse:
    # A resent chunk that did arrive, or one after a chunk that didn't: the
    # client carries on from `received`.
    return JSONResponse(
        status_code=409,
        content={"detail": "The upload is not at that offset", "received": received, "size": size},
    )


# Plain `def` endpoints, like main.py's: they write files, so they run in the
# threadpool rather than on the event loop.
@router.post("", status_code=201)
def create_upload(
    filename: str = Form(..., min_length=1, max_length=1024),
    size: int = Form(..., gt=0),
    model: str = Form(...),
    recover: bool = Form(False),
    recovery_model: str = Form(...),
):
    # Refused now rather than after the last chunk.
    _validate_settings(model, recover, recovery_model)
    if size > _max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File is larger than {_max_upload_mb:g} MB")

    _partial_dir().mkdir(parents=True, exist_ok=True)
    _purge_stale()
    upload_id = str(uuid.uuid4())
    _paths(upload_id)[0].touch()
    _write_meta(upload_id, {
        "filename": filename,
        "size": size,
        "model": model,
        "recover": recover,
        "recovery_model": recovery_model,
    })
    return {"upload_id": upload_id, "received": 0, "size": size, "chunk_size": CHUNK_SIZE}


@router.put("/{upload_id}")
def put_chunk(upload_id: str, offset: int = Form(..., ge=0), chunk: UploadFile = File(...)):
    """Append `chunk` at `offset`, which must be where the file ends."""
    upload_id = _parse_id(upload_id)
    with _lock(upload_id):
        meta = _read_meta(upload_id)
        received = _received(upload_id, meta)
        if meta.get("task_id") or offset != received:
            return _out_of_step(received, meta["size"])
        length = _size_of(chunk.file)
        if received + length > meta["size"]:
            raise HTTPException(status_code=413, detail="More bytes than the file's declared size")
        with open(_paths(upload_id)[0], "ab") as out:
            shutil.copyfileobj(chunk.file, out, 1024 * 1024)
        return {"received": received + length}


@router.get("/{upload_id}")
def get_upload(upload_id: str):
    upload_id = _parse_id(upload_id)
    with _lock(upload_id):
        meta = _read_meta(upload_id)
        return {"received": _received(upload_id, meta), "size": meta["size"], "task_id": meta.get("task_id")}


@router.post("/{upload_id}/complete")
def complete_upload(upload_id: str):
    """Turn the finished file into a job. Repeating it (a retry after a lost
    response) returns the same task_id instead of a second job."""
    upload_id = _parse_id(upload_id)
    with _lock(upload_id):
        meta = _read_meta(upload_id)
        if meta.get("task_id"):
            return {"task_id": meta["task_id"]}
        received = _received(upload_id, meta)
        if received != meta["size"]:
            return _out_of_step(received, meta["size"])

        # <task_id><ext> like POST /upload's file: the separators name their
        # output after it. The extension is the client's, so only a plain one.
        ext = Path(meta["filename"]).suffix
        if not (ext[1:].isascii() and ext[1:].isalnum() and len(ext) <= 10):
            ext = ""
        task_id = str(uuid.uuid4())
        part = _paths(upload_id)[0]
        file_path = _upload_dir / f"{task_id}{ext}"
        os.replace(part, file_path)
        try:
            _start_task(task_id, file_path, meta["filename"], meta["model"], meta["recover"], meta["recovery_model"])
        except HTTPException:
            # Refused (not audio, too long): the file is gone, and so is the upload.
            _forget(upload_id)
            raise
        except Exception:
            # Anything else (the database): keep the bytes for another try.
            if file_path.exists():
                os.replace(file_path, part)
            raise
        meta["task_id"] = task_id
        _write_meta(upload_id, meta)
        return {"task_id": task_id}


@router.delete("/{upload_id}", status_code=204)
def delete_upload(upload_id: str):
    """Cancel: drop the bytes received so far. A finished upload's job is
    not touched."""
    upload_id = _parse_id(upload_id)
    with _lock(upload_id):
        _read_meta(upload_id)
        _forget(upload_id)
    return Response(status_code=204)
