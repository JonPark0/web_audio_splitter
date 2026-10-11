"""
Sample library endpoints: extract a region of a separated stem (or import a
file) as a standalone sample, analyze its tempo/key, and browse/edit/delete.
"""
import io
import os
import queue
import shutil
import subprocess
import threading
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from json import dumps as _json_dumps
from pathlib import Path
from typing import Literal, Optional

import soundfile as sf
from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

import analysis
import numpy as np
import peaks
from db import session_scope
from models import Clip, Project, ProjectTrack, Sample
from storage import IMMUTABLE_CACHE_HEADERS, SAMPLES_DIR, track_path
from songs import ensure_song_analysis
from task_store import get_task, parse_id

router = APIRouter(prefix="/samples", tags=["samples"])

MIN_SAMPLE_SECONDS = 0.05
# Imports longer than this are refused: analysis cost grows with length and
# a library sample is a snippet, not a song (split songs on the Split screen).
MAX_IMPORT_SECONDS = 600
ZERO_CROSSING_WINDOW_SEC = 0.01  # how far a boundary may move to find a zero crossing
NORMALIZE_PEAK = 10 ** (-1 / 20)  # -1 dBFS
PEAKS_DIR = SAMPLES_DIR / "peaks"
# Time-stretched / pitch-shifted copies for the arrangement, keyed by source
# BPM, target BPM and semitones (see render_sample).
RENDER_DIR = SAMPLES_DIR / "renders"
RENDER_DIR.mkdir(parents=True, exist_ok=True)
# Renders are full-length float WAVs (a 3-minute sample is ~60 MB per
# tempo/pitch); least-recently-used ones are evicted past this size.
RENDER_CACHE_MB = float(os.getenv("RENDER_CACHE_MB", "4096") or 4096)
BPM_RANGE = (20.0, 999.0)
# "-x" sorts descending. Nulls (no BPM / key) always go last.
SORTS = ("newest", "oldest", "name", "-name", "bpm", "-bpm", "duration", "-duration", "key")


class SampleCreate(BaseModel):
    task_id: str
    track: str
    variant: Literal["original", "recovered"] = "original"
    start_sec: float = Field(ge=0)
    end_sec: float = Field(gt=0)
    name: Optional[str] = None
    tags: list[str] = []
    # Processing applied to the saved audio, in this order: boundaries moved
    # to the nearest zero crossing (avoids clicks at the cut), reverse,
    # normalize the peak to NORMALIZE_PEAK, then linear fades.
    snap_to_zero: bool = False
    reverse: bool = False
    normalize: bool = False
    fade_in_ms: float = Field(default=0, ge=0, le=10000)
    fade_out_ms: float = Field(default=0, ge=0, le=10000)
    # Output format; None keeps the source's (which differs per variant:
    # original stems may be 48 kHz float, recovered ones 44.1 kHz 16-bit).
    bit_depth: Optional[Literal[16, 24, 32]] = None  # 32 = float
    sample_rate: Optional[Literal[44100, 48000]] = None
    mono: bool = False


class MixStem(BaseModel):
    track: str
    variant: Literal["original", "recovered"] = "original"
    gain: float = Field(default=1.0, ge=0, le=4)


class SampleMixCreate(SampleCreate):
    """Several stems of one job summed into one sample ("what I hear"):
    `stems` replaces `track`/`variant`."""
    track: str = "mix"
    stems: list[MixStem] = Field(min_length=1, max_length=16)


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


# Analysis is CPU-heavy (librosa); run it on one dedicated worker so a burst
# of new samples queues up instead of competing with API requests (28 at
# once pushed GET /samples from 9 ms to ~100 ms).
_analysis_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="sample-analysis")


def queue_analysis(sample_id: str) -> None:
    _analysis_pool.submit(run_analysis, sample_id)


def run_analysis(sample_id: str) -> None:
    """Background task: detect tempo/key and store them on the sample."""
    with session_scope() as session:
        sample = session.get(Sample, uuid.UUID(sample_id))
        if sample is None:
            return
        path = sample.file_path
        source_task_id = sample.source_task_id
        source_track = sample.source_track or ""

    try:
        source = get_task(str(source_task_id)) if source_task_id else None
        bpm_hint = ensure_song_analysis(source)["bpm"] if source else None
        # A drums stem has no key; anything the detector finds there is leakage.
        skip_key = Path(source_track).stem.lower() == "drums" or source_track == "mix: drums"
        result = analysis.analyze_file(path, bpm_hint=bpm_hint, skip_key=skip_key)
        fields = {"bpm_detected": result["bpm"], "key_detected": result["key"], "analysis_status": "done"}
    except Exception as e:
        print(f"Analysis failed for sample {sample_id}: {e}")
        fields = {"analysis_status": "failed"}

    with session_scope() as session:
        sample = session.get(Sample, uuid.UUID(sample_id))
        if sample is not None:  # may have been deleted meanwhile
            for k, v in fields.items():
                setattr(sample, k, v)


def _snap_to_zero_crossings(src: Path, info, start: int, stop: int) -> tuple[int, int]:
    """Move each boundary to the nearest sign change of the mono sum within
    ZERO_CROSSING_WINDOW_SEC, so the cut doesn't click."""
    window = int(ZERO_CROSSING_WINDOW_SEC * info.samplerate)

    def nearest(frame: int) -> int:
        lo, hi = max(0, frame - window), min(info.frames, frame + window)
        if hi - lo < 2:
            return frame
        mono = sf.read(str(src), start=lo, stop=hi, always_2d=True)[0].mean(axis=1)
        crossings = np.nonzero(np.signbit(mono[:-1]) != np.signbit(mono[1:]))[0] + lo + 1
        return int(crossings[np.argmin(np.abs(crossings - frame))]) if crossings.size else frame

    new_start, new_stop = nearest(start), nearest(stop)
    return (new_start, new_stop) if new_stop - new_start > 0 else (start, stop)


def _process(data, sr: int, opts: SampleCreate):
    if opts.reverse:
        data = data[::-1]
    if opts.normalize:
        peak = float(np.abs(data).max()) if data.size else 0.0
        if peak > 0:
            data = data * (NORMALIZE_PEAK / peak)
    n = len(data)
    fade_in = min(n, int(opts.fade_in_ms / 1000 * sr))
    fade_out = min(n, int(opts.fade_out_ms / 1000 * sr))
    if fade_in or fade_out:
        data = np.array(data, dtype=np.float64, copy=True)
        if fade_in:
            data[:fade_in] *= np.linspace(0.0, 1.0, fade_in, endpoint=False)[:, None]
        if fade_out:
            data[n - fade_out:] *= np.linspace(1.0, 0.0, fade_out)[:, None]
    return data


def _safe_filename(name: str, fallback: str = "sample", keep: str = "") -> str:
    cleaned = "".join(c if c.isalnum() or c in " ._-()" + keep else "_" for c in name).strip(" .")
    return cleaned or fallback


@router.post("", status_code=201)
def create_sample(body: SampleCreate):
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

    if body.snap_to_zero:
        start, stop = _snap_to_zero_crossings(src, info, start, stop)

    data, sr = sf.read(str(src), start=start, stop=stop, always_2d=True)
    data = _process(data, sr, body)
    sample_id = uuid.uuid4()
    out_path = SAMPLES_DIR / f"{sample_id}.wav"
    _write_output(out_path, data, sr, info.subtype, body)

    name = (body.name or "").strip() or f"{Path(body.track).stem} {_format_time(body.start_sec)}"
    result = _insert_sample(
        out_path, name, body.tags,
        source_task_id=uuid.UUID(task["id"]),
        source_track=body.track,
        source_variant=body.variant,
        start_sec=start / sr,
        end_sec=stop / sr,
    )
    queue_analysis(result["id"])
    return result


@router.post("/mix", status_code=201)
def create_mix_sample(body: SampleMixCreate):
    """Cut [start_sec, end_sec) out of several stems, summed with per-stem
    gains (e.g. the mixer's current mute/solo/volume), into one sample."""
    task = get_task(body.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task is not completed")

    sources = []
    for stem in body.stems:
        src = track_path(task, stem.track, stem.variant)
        if src is None:
            raise HTTPException(status_code=404, detail=f"Track not found: {stem.track} ({stem.variant})")
        sources.append((src, sf.info(str(src)), stem.gain))
    audible = [(src, info, gain) for src, info, gain in sources if gain > 0]
    if not audible:
        raise HTTPException(status_code=400, detail="Every stem in the mix is silent")

    # Mix at the first stem's rate; others are resampled to it (original
    # and recovered variants can differ: 48 kHz vs 44.1 kHz).
    sr = audible[0][1].samplerate
    length = int(round((body.end_sec - body.start_sec) * sr))
    if length < MIN_SAMPLE_SECONDS * sr:
        raise HTTPException(status_code=400, detail="Selection is empty or too short")
    mix = np.zeros((length, 2), dtype=np.float64)
    for src, info, gain in audible:
        start = int(round(body.start_sec * info.samplerate))
        stop = min(int(round(body.end_sec * info.samplerate)), info.frames)
        data = sf.read(str(src), start=start, stop=stop, always_2d=True)[0]
        if data.shape[1] == 1:
            data = np.repeat(data, 2, axis=1)
        if info.samplerate != sr:
            import librosa
            data = librosa.resample(data.T, orig_sr=info.samplerate, target_sr=sr, axis=-1).T
        n = min(length, len(data))
        mix[:n] += data[:n, :2] * gain

    mix = _process(mix, sr, body)
    sample_id = uuid.uuid4()
    out_path = SAMPLES_DIR / f"{sample_id}.wav"
    _write_output(out_path, mix, sr, "FLOAT", body)

    tracks = [stem.track for stem in body.stems if stem.gain > 0]
    name = (body.name or "").strip() or f"mix {_format_time(body.start_sec)}"
    result = _insert_sample(
        out_path, name, body.tags,
        source_task_id=uuid.UUID(task["id"]),
        source_track="mix: " + ", ".join(Path(t).stem for t in tracks),
        source_variant="mix",
        start_sec=body.start_sec,
        end_sec=body.start_sec + length / sr,
    )
    queue_analysis(result["id"])
    return result


def _write_output(path: Path, data, sr: int, source_subtype: str, opts: SampleCreate) -> None:
    """Write with the requested format (or the source's)."""
    if opts.mono and data.shape[1] > 1:
        data = data.mean(axis=1, keepdims=True)
    if opts.sample_rate and opts.sample_rate != sr:
        import librosa
        data = librosa.resample(data.T, orig_sr=sr, target_sr=opts.sample_rate, axis=-1).T
        sr = opts.sample_rate
    subtype = {16: "PCM_16", 24: "PCM_24", 32: "FLOAT"}.get(opts.bit_depth or 0)
    if subtype is None:
        subtype = source_subtype if sf.check_format("WAV", source_subtype) else "FLOAT"
    if subtype != "FLOAT":
        data = np.clip(data, -1.0, 1.0)  # integer PCM can't hold overs
    sf.write(str(path), data, sr, subtype=subtype)


@router.post("/import", status_code=201)
def import_sample(
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
    if sf.info(str(out_path)).duration > MAX_IMPORT_SECONDS:
        out_path.unlink(missing_ok=True)
        raise HTTPException(
            status_code=400,
            detail=f"Samples are limited to {MAX_IMPORT_SECONDS // 60} minutes; split longer audio on the Split screen",
        )

    default_name = Path(file.filename or "sample").stem
    result = _insert_sample(
        out_path,
        (name or "").strip() or default_name,
        (tags or "").split(","),
    )
    queue_analysis(result["id"])
    return result


@router.get("")
def list_samples(
    q: Optional[str] = None,
    tag: Optional[str] = None,
    tags: Optional[str] = None,
    key: Optional[str] = None,
    bpm_min: Optional[float] = None,
    bpm_max: Optional[float] = None,
    sort: str = "newest",
    task_id: Optional[str] = None,
    limit: int = Query(default=0, ge=0, le=1000),
    offset: int = Query(default=0, ge=0),
):
    """Filtered, sorted samples. `q` matches the name, a tag or the source
    stem; `tags` (comma-separated) requires all of them; `task_id` limits to
    samples cut from one job; `limit` 0 = all. `total` is the unfiltered
    library size, `matched` the filtered count."""
    if sort not in SORTS:
        raise HTTPException(status_code=400, detail=f"sort must be one of {', '.join(SORTS)}")

    stmt = select(Sample)
    if task_id:
        tid = parse_id(task_id)
        if tid is None:
            raise HTTPException(status_code=400, detail="task_id must be a UUID")
        stmt = stmt.where(Sample.source_task_id == tid)
    if q:
        term = q.strip()
        stmt = stmt.where(or_(
            Sample.name.icontains(term, autoescape=True),
            Sample.source_track.icontains(term, autoescape=True),
            func.array_to_string(Sample.tags, " ").icontains(term, autoescape=True),
        ))
    wanted = [t.strip().lower() for t in (tags or "").split(",") if t.strip()]
    if tag:
        wanted.append(tag.strip().lower())
    if wanted:
        stmt = stmt.where(Sample.tags.contains(wanted))
    if key:
        stmt = stmt.where(_effective_key() == key)
    if bpm_min is not None:
        stmt = stmt.where(_effective_bpm() >= bpm_min)
    if bpm_max is not None:
        stmt = stmt.where(_effective_bpm() <= bpm_max)

    # Every order ends on the unique id: with ties left to the planner, rows
    # come back in a limit-dependent order and offset paging repeats/skips them.
    order = {
        "newest": [Sample.created_at.desc(), Sample.id.desc()],
        "oldest": [Sample.created_at.asc(), Sample.id.asc()],
        "name": [func.lower(Sample.name).asc(), Sample.id.asc()],
        "-name": [func.lower(Sample.name).desc(), Sample.id.desc()],
        "bpm": [_effective_bpm().asc().nulls_last(), Sample.created_at.desc(), Sample.id.desc()],
        "-bpm": [_effective_bpm().desc().nulls_last(), Sample.created_at.desc(), Sample.id.desc()],
        "duration": [Sample.duration_sec.asc(), Sample.id.asc()],
        "-duration": [Sample.duration_sec.desc(), Sample.id.desc()],
        "key": [_effective_key().asc().nulls_last(), func.lower(Sample.name).asc(), Sample.id.asc()],
    }[sort]
    with session_scope() as session:
        matched = session.scalar(select(func.count()).select_from(stmt.subquery()))
        total = session.scalar(select(func.count()).select_from(Sample))
        page = stmt.order_by(*order).offset(offset)
        if limit:
            page = page.limit(limit)
        rows = session.scalars(page).all()
        return {"samples": [_serialize(s) for s in rows], "matched": matched, "total": total}


class SampleIds(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=2000)


@router.post("/export")
def export_samples(body: SampleIds):
    """The given samples as one zip (streamed), files named after the
    samples (duplicates numbered)."""
    ids = [sid for sid in (parse_id(i) for i in body.ids) if sid]
    with session_scope() as session:
        rows = session.scalars(select(Sample).where(Sample.id.in_(ids))).all() if ids else []
        entries, seen = [], {}
        for sample in rows:
            base = _safe_filename(sample.name)
            n = seen.get(base, 0)
            seen[base] = n + 1
            entries.append((Path(sample.file_path), f"{base}.wav" if n == 0 else f"{base} ({n + 1}).wav"))
    entries = [(path, name) for path, name in entries if path.is_file()]
    if not entries:
        raise HTTPException(status_code=404, detail="No samples to export")
    return StreamingResponse(
        _zip_stream(entries), media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="samples.zip"'},
    )


class _QueueWriter(io.RawIOBase):
    def __init__(self, q):
        self.q = q

    def writable(self):
        return True

    def write(self, b):
        self.q.put(bytes(b))
        return len(b)


def _zip_stream(entries):
    q: queue.Queue = queue.Queue(maxsize=16)

    def produce():
        try:
            with zipfile.ZipFile(_QueueWriter(q), "w", compression=zipfile.ZIP_STORED) as zf:
                for path, arcname in entries:
                    with open(path, "rb") as src, zf.open(arcname, "w", force_zip64=True) as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
        finally:
            q.put(None)

    threading.Thread(target=produce, daemon=True).start()
    while (chunk := q.get()) is not None:
        yield chunk


@router.post("/analyze")
def reanalyze_samples(body: SampleIds):
    """Re-run tempo/key detection for the given samples (all samples if
    `ids` is empty). User overrides are kept; only detected values change."""
    with session_scope() as session:
        stmt = select(Sample)
        ids = [sid for sid in (parse_id(i) for i in body.ids) if sid]
        if ids:
            stmt = stmt.where(Sample.id.in_(ids))
        rows = session.scalars(stmt).all()
        for sample in rows:
            sample.analysis_status = "pending"
        targets = [str(sample.id) for sample in rows]
    for sample_id in targets:
        queue_analysis(sample_id)
    return {"queued": len(targets)}


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
            bpm = round(body.bpm, 2) if body.bpm is not None else None
            # Setting the detected value back is a reset, not an override.
            sample.bpm_override = None if bpm is not None and bpm == sample.bpm_detected else bpm
            _drop_renders(sample.id)  # stretched against the old source BPM
        if "key" in fields:
            if body.key is not None and body.key not in analysis.VALID_KEYS:
                raise HTTPException(status_code=400, detail="Unknown key")
            sample.key_override = None if body.key == sample.key_detected else body.key

        session.flush()
        session.refresh(sample)
        return _serialize(sample)


@router.post("/{sample_id}/analyze")
def reanalyze_sample(sample_id: str):
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)
        sample.analysis_status = "pending"
        session.flush()
        session.refresh(sample)
        result = _serialize(sample)
    queue_analysis(result["id"])
    return result


@router.delete("/{sample_id}", status_code=204)
def delete_sample(sample_id: str):
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)
        used_in = session.execute(
            select(Project.id, Project.name)
            .join(ProjectTrack, ProjectTrack.project_id == Project.id)
            .join(Clip, Clip.track_id == ProjectTrack.id)
            .where(Clip.sample_id == sample.id)
            .distinct()
        ).all()
        if used_in:
            # `detail` stays a string for generic error display; `projects`
            # lets the UI link to them.
            names = ", ".join(name for _, name in used_in)
            return JSONResponse(status_code=409, content={
                "detail": f"Sample is used in project(s): {names}. Remove its clips first.",
                "projects": [{"id": str(pid), "name": name} for pid, name in used_in],
            })
        path = Path(sample.file_path)
        session.delete(sample)
    path.unlink(missing_ok=True)
    _drop_renders(uuid.UUID(sample_id))
    return Response(status_code=204)


def _drop_renders(sample_id: uuid.UUID) -> None:
    for f in RENDER_DIR.glob(f"{sample_id}_*.wav"):
        f.unlink(missing_ok=True)
    for f in PEAKS_DIR.glob(f"{sample_id}_*.json"):
        f.unlink(missing_ok=True)


@router.get("/{sample_id}/render")
def render_sample(
    sample_id: str,
    bpm: float = Query(ge=BPM_RANGE[0], le=BPM_RANGE[1]),
    semitones: int = Query(default=0, ge=-24, le=24),
    cents: int = Query(default=0, ge=-100, le=100),
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
    pitch = semitones + cents / 100
    if abs(factor - 1.0) < 1e-4 and pitch == 0:
        return FileResponse(path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS)

    pitch_tag = f"{semitones}" if not cents else f"{semitones}c{cents}"
    cache_path = RENDER_DIR / f"{sample.id}_{src_bpm or 0:.2f}_{bpm:.2f}_{pitch_tag}.wav"
    if cache_path.exists():
        cache_path.touch()  # mark as recently used for eviction
    else:
        import numpy as np
        import pedalboard  # pinned to a build that runs on AVX2-only CPUs (see requirements-app.txt)

        audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
        # stretch_factor > 1 speeds up (shorter output): 1.25 turned 44100
        # frames into 35280, verified empirically.
        out = pedalboard.time_stretch(
            np.ascontiguousarray(audio.T), sr,
            stretch_factor=factor, pitch_shift_in_semitones=float(pitch), high_quality=True,
        )
        # FLOAT: stretching can push peaks past 1.0, which PCM would clip.
        tmp_path = RENDER_DIR / f".tmp_{uuid.uuid4()}.wav"
        sf.write(str(tmp_path), out.T, sr, subtype="FLOAT")
        os.replace(tmp_path, cache_path)  # atomic, so concurrent requests never read a partial file
        _evict_renders(keep=cache_path)

    return FileResponse(cache_path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS)


def _evict_renders(keep: Path) -> None:
    files = [f for f in RENDER_DIR.glob("*.wav") if f != keep]
    total = sum(f.stat().st_size for f in files) + keep.stat().st_size
    limit = RENDER_CACHE_MB * 1024 * 1024
    for f in sorted(files, key=lambda f: f.stat().st_mtime):
        if total <= limit:
            break
        total -= f.stat().st_size
        f.unlink(missing_ok=True)


@router.delete("/renders/cache", status_code=204)
def clear_render_cache():
    """Drop every cached time-stretch/pitch render (they're re-made on use)."""
    for f in RENDER_DIR.glob("*.wav"):
        f.unlink(missing_ok=True)
    return Response(status_code=204)


@router.get("/{sample_id}/audio")
def sample_audio(sample_id: str, download: Optional[str] = Query(default=None, max_length=300)):
    """The sample's WAV. With ?download=<name> it comes as an attachment
    under that name (the library's "<name>_<bpm>bpm_<key>.wav"), so a plain
    link saves it and the browser streams it to disk, instead of the page
    fetching the whole file into a blob first (which mobile browsers handle
    badly)."""
    with session_scope() as session:
        sample = _get_or_404(session, sample_id)
        path, name = Path(sample.file_path), sample.name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Sample audio missing")
    if download is not None:
        # "#" kept: it's the sharp in a key ("C#min").
        stem = _safe_filename(download, fallback=_safe_filename(name), keep="#")
        if stem.lower().endswith(".wav"):
            stem = stem[:-4].rstrip(" .") or _safe_filename(name)
        return FileResponse(
            path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS,
            filename=f"{stem}.wav", content_disposition_type="attachment",
        )
    # Named after the sample, for downloads; "inline" so <audio> still plays it.
    return FileResponse(
        path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS,
        filename=f"{_safe_filename(name)}.wav", content_disposition_type="inline",
    )


@router.get("/{sample_id}/peaks")
def sample_peaks(sample_id: str, points: int = Query(default=400, ge=16, le=4000)):
    """Waveform overview of the whole sample in `points` buckets (see peaks.py)."""
    with session_scope() as session:
        path = Path(_get_or_404(session, sample_id).file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Sample audio missing")
    data = peaks.cached(path, PEAKS_DIR / f"{path.stem}_{points}.json", total_points=points)
    return Response(content=_json_dumps(data, separators=(',', ':')), media_type="application/json", headers=IMMUTABLE_CACHE_HEADERS)
