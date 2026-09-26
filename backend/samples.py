"""
Sample library endpoints: extract a region of a separated stem (or import a
file) as a standalone sample, analyze its tempo/key, and browse/edit/delete.
"""
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Literal, Optional

import soundfile as sf
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select

import analysis
from db import session_scope
from models import Clip, Project, ProjectTrack, Sample
from storage import IMMUTABLE_CACHE_HEADERS, SAMPLES_DIR, track_path
from task_store import get_task, parse_id

router = APIRouter(prefix="/samples", tags=["samples"])

MIN_SAMPLE_SECONDS = 0.05
# Time-stretched / pitch-shifted copies for the arrangement, keyed by source
# BPM, target BPM and semitones (see render_sample).
RENDER_DIR = SAMPLES_DIR / "renders"
RENDER_DIR.mkdir(parents=True, exist_ok=True)
BPM_RANGE = (20.0, 999.0)
SORTS = ("newest", "oldest", "name", "bpm")


class SampleCreate(BaseModel):
    task_id: str
    track: str
    variant: Literal["original", "recovered"] = "original"
    start_sec: float = Field(ge=0)
    end_sec: float = Field(gt=0)
    name: Optional[str] = None
    tags: list[str] = []


class SampleUpdate(BaseModel):
    # Omitted fields are left alone; explicit null for bpm/key clears the
    # user override (reverting to the detected value) — see model_fields_set.
    name: Optional[str] = None
    tags: Optional[list[str]] = None
    bpm: Optional[float] = None
    key: Optional[str] = None


def _effective_bpm():
    return func.coalesce(Sample.bpm_override, Sample.bpm_detected)


def _effective_key():
    return func.coalesce(Sample.key_override, Sample.key_detected)


def _serialize(s: Sample) -> dict:
    source = None
    if s.source_track is not None:
        source = {
            "task_id": str(s.source_task_id) if s.source_task_id else None,
            "track": s.source_track,
            "variant": s.source_variant,
            "start_sec": s.start_sec,
            "end_sec": s.end_sec,
        }
    return {
        "id": str(s.id),
        "name": s.name,
        "duration_sec": s.duration_sec,
        "sample_rate": s.sample_rate,
        "channels": s.channels,
        "bpm": s.bpm_override if s.bpm_override is not None else s.bpm_detected,
        "bpm_detected": s.bpm_detected,
        "bpm_overridden": s.bpm_override is not None,
        "key": s.key_override or s.key_detected,
        "key_detected": s.key_detected,
        "key_overridden": s.key_override is not None,
        "tags": list(s.tags or []),
        "analysis_status": s.analysis_status,
        "source": source,
        "audio_url": f"/samples/{s.id}/audio",
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _clean_tags(tags: list[str]) -> list[str]:
    # Lower-cased and whitespace-collapsed so the exact-match tag filter
    # doesn't treat "Keys" and "keys" as different tags.
    out = []
    for tag in tags:
        tag = " ".join(tag.split()).lower()
        if tag and tag not in out:
            out.append(tag)
    return out


def _format_time(seconds: float) -> str:
    minutes, secs = divmod(int(seconds), 60)
    return f"{minutes}:{secs:02d}"


def _get_or_404(session, sample_id: str) -> Sample:
    sid = parse_id(sample_id)
    sample = session.get(Sample, sid) if sid else None
    if sample is None:
        raise HTTPException(status_code=404, detail="Sample not found")
    return sample


def _insert_sample(path: Path, name: str, tags: list[str], **source) -> dict:
    info = sf.info(str(path))
    with session_scope() as session:
        sample = Sample(
            id=uuid.UUID(path.stem),
            name=name,
            file_path=str(path),
            duration_sec=info.frames / info.samplerate,
            sample_rate=info.samplerate,
            channels=info.channels,
            tags=_clean_tags(tags),
            analysis_status="pending",
            **source,
        )
        session.add(sample)
        session.flush()
        session.refresh(sample)
        return _serialize(sample)


def run_analysis(sample_id: str) -> None:
    """Background task: detect tempo/key and store them on the sample."""
    with session_scope() as session:
        sample = session.get(Sample, uuid.UUID(sample_id))
        if sample is None:
            return
        path = sample.file_path

    try:
        result = analysis.analyze_file(path)
        fields = {"bpm_detected": result["bpm"], "key_detected": result["key"], "analysis_status": "done"}
    except Exception as e:
        print(f"Analysis failed for sample {sample_id}: {e}")
        fields = {"analysis_status": "failed"}

    with session_scope() as session:
        sample = session.get(Sample, uuid.UUID(sample_id))
        if sample is not None:  # may have been deleted meanwhile
            for k, v in fields.items():
                setattr(sample, k, v)


@router.post("", status_code=201)
def create_sample(body: SampleCreate, background_tasks: BackgroundTasks):
    """Cut [start_sec, end_sec) out of a stem into a new library sample."""
    task = get_task(body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task is not completed")
    src = track_path(task, body.track, body.variant)
    if src is None:
        raise HTTPException(status_code=404, detail="Track not found")

    info = sf.info(str(src))
    # Frame offsets (not ffmpeg -ss) so the cut is sample-accurate.
    start = int(round(body.start_sec * info.samplerate))
    stop = min(int(round(body.end_sec * info.samplerate)), info.frames)
    if stop - start < MIN_SAMPLE_SECONDS * info.samplerate:
        raise HTTPException(status_code=400, detail="Selection is empty or too short")

    data, sr = sf.read(str(src), start=start, stop=stop, always_2d=True)
    sample_id = uuid.uuid4()
    out_path = SAMPLES_DIR / f"{sample_id}.wav"
    subtype = info.subtype if sf.check_format("WAV", info.subtype) else "FLOAT"
    sf.write(str(out_path), data, sr, subtype=subtype)

    name = (body.name or "").strip() or f"{Path(body.track).stem} {_format_time(body.start_sec)}"
    result = _insert_sample(
        out_path, name, body.tags,
        source_task_id=uuid.UUID(task["id"]),
        source_track=body.track,
        source_variant=body.variant,
        start_sec=start / sr,
        end_sec=stop / sr,
    )
    background_tasks.add_task(run_analysis, result["id"])
    return result


@router.post("/import", status_code=201)
def import_sample(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    tags: Optional[str] = Form(None),
):
    """Add a local audio file to the library, normalized to WAV via ffmpeg."""
    sample_id = uuid.uuid4()
    tmp_path = SAMPLES_DIR / f".import_{sample_id}{Path(file.filename or '').suffix}"
    out_path = SAMPLES_DIR / f"{sample_id}.wav"
    with open(tmp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(tmp_path), "-vn", "-c:a", "pcm_s24le", str(out_path)]
    process = subprocess.run(cmd, capture_output=True, text=True)
    tmp_path.unlink(missing_ok=True)
    if process.returncode != 0 or not out_path.exists():
        out_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Unsupported or unreadable audio file")

    default_name = Path(file.filename or "sample").stem
    result = _insert_sample(
        out_path,
        (name or "").strip() or default_name,
        (tags or "").split(","),
    )
    background_tasks.add_task(run_analysis, result["id"])
    return result


@router.get("")
def list_samples(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    key: Optional[str] = None,
    bpm_min: Optional[float] = None,
    bpm_max: Optional[float] = None,
    sort: str = "newest",
):
    if sort not in SORTS:
        raise HTTPException(status_code=400, detail=f"sort must be one of {', '.join(SORTS)}")

    stmt = select(Sample)
    if q:
        stmt = stmt.where(Sample.name.icontains(q, autoescape=True))
    if tag:
        stmt = stmt.where(Sample.tags.any(tag))
    if key:
        stmt = stmt.where(_effective_key() == key)
    if bpm_min is not None:
        stmt = stmt.where(_effective_bpm() >= bpm_min)
    if bpm_max is not None:
        stmt = stmt.where(_effective_bpm() <= bpm_max)

    order = {
        "newest": [Sample.created_at.desc()],
        "oldest": [Sample.created_at.asc()],
        "name": [func.lower(Sample.name).asc()],
        "bpm": [_effective_bpm().asc().nulls_last(), Sample.created_at.desc()],
    }[sort]
    with session_scope() as session:
        rows = session.scalars(stmt.order_by(*order)).all()
        return {"samples": [_serialize(s) for s in rows]}


# Declared before "/{sample_id}" so "tags" isn't captured as an id.
@router.get("/tags")
def list_tags():
    tag = func.unnest(Sample.tags).label("tag")
    sub = select(tag).subquery()
    stmt = (
        select(sub.c.tag, func.count().label("count"))
        .group_by(sub.c.tag)
        .order_by(func.count().desc(), sub.c.tag)
    )
    with session_scope() as session:
        return {"tags": [{"name": name, "count": count} for name, count in session.execute(stmt)]}


@router.get("/{sample_id}")
def get_sample(sample_id: str):
    with session_scope() as session:
        return _serialize(_get_or_404(session, sample_id))


@router.patch("/{sample_id}")
def update_sample(sample_id: str, body: SampleUpdate):
    fields = body.model_fields_set
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)

        if "name" in fields:
            name = (body.name or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Name cannot be empty")
            sample.name = name
        if "tags" in fields:
            sample.tags = _clean_tags(body.tags or [])
        if "bpm" in fields:
            if body.bpm is not None and not (BPM_RANGE[0] <= body.bpm <= BPM_RANGE[1]):
                raise HTTPException(status_code=400, detail=f"BPM must be between {BPM_RANGE[0]:g} and {BPM_RANGE[1]:g}")
            sample.bpm_override = round(body.bpm, 2) if body.bpm is not None else None
            _drop_renders(sample.id)  # stretched against the old source BPM
        if "key" in fields:
            if body.key is not None and body.key not in analysis.VALID_KEYS:
                raise HTTPException(status_code=400, detail="Unknown key")
            sample.key_override = body.key

        session.flush()
        session.refresh(sample)
        return _serialize(sample)


@router.post("/{sample_id}/analyze")
def reanalyze_sample(sample_id: str, background_tasks: BackgroundTasks):
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)
        sample.analysis_status = "pending"
        session.flush()
        session.refresh(sample)
        result = _serialize(sample)
    background_tasks.add_task(run_analysis, result["id"])
    return result


@router.delete("/{sample_id}", status_code=204)
def delete_sample(sample_id: str):
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)
        used_in = session.scalars(
            select(Project.name)
            .join(ProjectTrack, ProjectTrack.project_id == Project.id)
            .join(Clip, Clip.track_id == ProjectTrack.id)
            .where(Clip.sample_id == sample.id)
            .distinct()
        ).all()
        if used_in:
            raise HTTPException(
                status_code=409,
                detail=f"Sample is used in project(s): {', '.join(used_in)}. Remove its clips first.",
            )
        path = Path(sample.file_path)
        session.delete(sample)
    path.unlink(missing_ok=True)
    _drop_renders(uuid.UUID(sample_id))
    return Response(status_code=204)


def _drop_renders(sample_id: uuid.UUID) -> None:
    for f in RENDER_DIR.glob(f"{sample_id}_*.wav"):
        f.unlink(missing_ok=True)


@router.get("/{sample_id}/render")
def render_sample(
    sample_id: str,
    bpm: float = Query(ge=BPM_RANGE[0], le=BPM_RANGE[1]),
    semitones: int = Query(default=0, ge=-24, le=24),
):
    """The sample time-stretched from its own BPM to `bpm` and pitch-shifted
    by `semitones`, rendered once with Rubber Band (pedalboard) and cached.

    Without a sample BPM only the pitch shift applies. Any extra query
    params (the client adds the source BPM) only serve as a browser
    cache-buster.
    """
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)
        path = Path(sample.file_path)
        src_bpm = sample.bpm_override if sample.bpm_override is not None else sample.bpm_detected

    factor = bpm / src_bpm if src_bpm else 1.0
    if abs(factor - 1.0) < 1e-4 and semitones == 0:
        return FileResponse(path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS)

    cache_path = RENDER_DIR / f"{sample.id}_{src_bpm or 0:.2f}_{bpm:.2f}_{semitones}.wav"
    if not cache_path.exists():
        import numpy as np
        import pedalboard  # pinned to a build that runs on AVX2-only CPUs (see requirements-app.txt)

        audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
        # stretch_factor > 1 speeds up (shorter output): 1.25 turned 44100
        # frames into 35280, verified empirically.
        out = pedalboard.time_stretch(
            np.ascontiguousarray(audio.T), sr,
            stretch_factor=factor, pitch_shift_in_semitones=float(semitones), high_quality=True,
        )
        # FLOAT: stretching can push peaks past 1.0, which PCM would clip.
        tmp_path = RENDER_DIR / f".tmp_{uuid.uuid4()}.wav"
        sf.write(str(tmp_path), out.T, sr, subtype="FLOAT")
        os.replace(tmp_path, cache_path)  # atomic, so concurrent requests never read a partial file

    return FileResponse(cache_path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS)


@router.get("/{sample_id}/audio")
def sample_audio(sample_id: str):
    with session_scope() as session:
        path = Path(_get_or_404(session, sample_id).file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Sample audio missing")
    return FileResponse(path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS)
