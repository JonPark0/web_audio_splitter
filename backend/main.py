import asyncio
import io
import json
import os
import queue
import threading
import shutil
import uuid
import subprocess
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form, Query
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

import jobs
import peaks
import projects
import samples
from restore import restore_stems, RestoreError, SUPPORTED_MODELS, DEFAULT_MODEL
from separate import (
    separate_audio, SeparationError, DERIVED_STEMS, DEMUCS_MODELS, BS_ROFORMER_MODEL, describe_failure,
)
from songs import ensure_song_analysis, song_analysis_or_start
from storage import (
    IMMUTABLE_CACHE_HEADERS, OUTPUT_DIR, PEAKS_DIR, RECOVERED_SUBDIR, SPECTROGRAM_DIR,
    UPLOAD_DIR, VARIANTS, stems_dir, track_path,
)
from task_store import (
    IN_FLIGHT_STATUSES, count_in_flight, create_task, delete_task_row, fail_interrupted_tasks, get_task,
    list_queued_tasks, list_tasks, list_tasks_older_than, update_task,
)

SEPARATION_MODELS = DEMUCS_MODELS | {BS_ROFORMER_MODEL}
# Opt-in cleanup: jobs older than this many days have their uploaded audio,
# stems and spectrograms deleted (library samples are copies and survive).
# 0 / unset = keep everything.
MEDIA_RETENTION_DAYS = float(os.getenv("MEDIA_RETENTION_DAYS", "0") or 0)
RETENTION_CHECK_SECONDS = 6 * 3600
# Upload size limit (the 30-minute duration limit applies to uploads and YouTube alike).
MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "1024") or 1024)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Jobs whose worker thread died with the previous process would
    # otherwise show as running forever.
    interrupted = fail_interrupted_tasks()
    if interrupted:
        print(f"Marked {interrupted} interrupted task(s) as failed")
    # Queued jobs never started, so they can simply run now (oldest first).
    jobs.start()
    for task in list_queued_tasks():
        if task.get("file_path") and Path(task["file_path"]).is_file():
            enqueue(task["id"], Path(task["file_path"]), task["model"], task["recover"], task["recovery_model"])
        else:
            update_task(task["id"], status="failed", error="Source audio missing after a restart")
    cleanup = asyncio.create_task(_retention_loop()) if MEDIA_RETENTION_DAYS > 0 else None
    yield
    if cleanup:
        cleanup.cancel()


async def _retention_loop():
    while True:
        try:
            removed = await asyncio.to_thread(purge_old_tasks, MEDIA_RETENTION_DAYS)
            if removed:
                print(f"Retention: removed {removed} job(s) older than {MEDIA_RETENTION_DAYS:g} day(s)")
        except Exception as e:
            print(f"Retention cleanup failed: {e}")
        await asyncio.sleep(RETENTION_CHECK_SECONDS)


def remove_task(task: dict) -> None:
    """Delete a job's uploaded audio, stems (incl. recovered) and cached
    spectrograms, then its row."""
    file_path = task.get("file_path")
    if file_path and Path(file_path).resolve().parent == UPLOAD_DIR.resolve():
        Path(file_path).unlink(missing_ok=True)
    shutil.rmtree(stems_dir(task), ignore_errors=True)
    shutil.rmtree(SPECTROGRAM_DIR / task["id"], ignore_errors=True)
    shutil.rmtree(PEAKS_DIR / task["id"], ignore_errors=True)
    delete_task_row(task["id"])


def purge_old_tasks(days: float) -> int:
    old = list_tasks_older_than(days)
    for task in old:
        remove_task(task)
    return len(old)


app = FastAPI(lifespan=lifespan)

# CORS configuration
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(samples.router)
app.include_router(projects.router)

MAX_DURATION_SECONDS = 1800  # 30 minutes


def format_duration(seconds: int) -> str:
    minutes, secs = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def recovery_device() -> str:
    """Device for the restoration models, independent of how Demucs picks its
    own device — driven by the same USE_GPU env var used at image build time
    (see backend/Dockerfile / docker-compose.*.yml)."""
    return "cuda" if os.getenv("USE_GPU", "false").lower() == "true" else "cpu"


def set_progress(task_id: str, step: str, step_index: int, step_total: int, current_stem: str = None):
    fields = {"step": step, "step_index": step_index, "step_total": step_total}
    if current_stem is not None:
        fields["current_stem"] = current_stem
    update_task(task_id, **fields)


def process_audio(task_id: str, file_path: Path, model: str, recover: bool = False, recovery_model: str = DEFAULT_MODEL):
    """The job (runs on a jobs.py worker): separate, analyse the song, then
    optionally restore each stem. Cancellation surfaces as jobs.JobCancelled."""
    update_task(task_id, started_at=_now_iso())
    try:
        _process_audio(task_id, file_path, model, recover, recovery_model)
    except jobs.JobCancelled:
        update_task(task_id, status="cancelled", error="Cancelled")
    finally:
        update_task(task_id, finished_at=_now_iso())
    task = get_task(task_id)
    if task and task["status"] == "completed":
        warm_peaks(task_id)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _process_audio(task_id: str, file_path: Path, model: str, recover: bool, recovery_model: str):
    update_task(task_id, status="processing", recover=recover, recovery_model=recovery_model)

    # Step budget: 1 separation step, plus 1 step per stem when recovering.
    # Stem count isn't known until Demucs finishes, so it's set to a
    # provisional total of 1 here and corrected once stems are known.
    set_progress(task_id, "separating", 0, 1)

    shifts = int(os.getenv("DEMUCS_SHIFTS", 0))

    try:
        # Separation (Demucs family or BS-Roformer — see separate.py).
        # Demucs auto-uses GPU if available and PyTorch is configured;
        # BS-Roformer auto-detects CUDA the same way.
        try:
            separate_audio(file_path, OUTPUT_DIR, model, shifts, recovery_device())
        except SeparationError as e:
            print(f"Error processing {task_id}: {e}")
            update_task(task_id, status="failed", error=f"Separation failed: {describe_failure(str(e))}")
            return

        # Tempo/key of the whole song: shown on the result screen and
        # inherited by samples cut from it. A few seconds; failures are
        # logged and left as None.
        task_now = get_task(task_id)
        if task_now:
            ensure_song_analysis(task_now)
        jobs.check_cancelled()

        if not recover:
            update_task(task_id, status="completed")
            return

        # --- Recovery stage ---
        demucs_out_dir = OUTPUT_DIR / model / task_id
        stems = [p for p in sorted(demucs_out_dir.glob("*.wav")) if p.stem not in DERIVED_STEMS]

        if not stems:
            update_task(task_id, status="completed")
            return

        device = recovery_device()
        recovered_dir = demucs_out_dir / RECOVERED_SUBDIR
        recovered_dir.mkdir(parents=True, exist_ok=True)

        set_progress(task_id, "restoring", 0, len(stems))
        update_task(task_id, status="restoring")

        pairs = [(stem_path, recovered_dir / stem_path.name) for stem_path in stems]
        try:
            restore_stems(
                pairs, recovery_model, device,
                on_stem_start=lambda i: set_progress(task_id, "restoring", i, len(stems), current_stem=stems[i].stem),
            )
        except RestoreError as e:
            # Keep the original (split-only) stems intact; surface the
            # restoration failure without discarding the split result.
            print(f"Recovery failed for {task_id}/{e.stem}: {e}")
            error = f"Recovery failed on '{e.stem}': {e}" if e.stem else f"Recovery failed: {e}"
            update_task(task_id, status="failed", error=error)
            return

        set_progress(task_id, "restoring", len(stems), len(stems))
        update_task(task_id, status="completed")

    except jobs.JobCancelled:
        raise
    except Exception as e:
        print(f"Exception for {task_id}: {e}")
        update_task(task_id, status="failed", error=str(e))


def probe_audio(path: Path) -> float:
    """Duration in seconds of an audio file; HTTP 400 if it isn't one."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_type:format=duration", "-of", "json", str(path),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)
    try:
        info = json.loads(process.stdout or "{}")
    except ValueError:
        info = {}
    if process.returncode != 0 or not info.get("streams"):
        raise HTTPException(status_code=400, detail="Unsupported or unreadable audio file")
    try:
        return float(info.get("format", {}).get("duration") or 0)
    except ValueError:
        return 0.0


def validate_settings(model: str, recover: bool, recovery_model: str) -> None:
    if model not in SEPARATION_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown separation model '{model}'")
    if recover and recovery_model.lower() not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown recovery_model '{recovery_model}'")


def enqueue(task_id: str, file_path: Path, model: str, recover: bool, recovery_model: str) -> None:
    jobs.submit(task_id, process_audio, file_path, model, recover, recovery_model)


def warm_peaks(task_id: str) -> None:
    """Precompute waveform peaks for every stem of a finished job in the
    background, so the first open of its mixer is instant (each stem takes
    ~2 s cold)."""
    def run():
        task = get_task(task_id)
        if not task:
            return
        base = stems_dir(task)
        for variant, folder in (("original", base), ("recovered", base / RECOVERED_SUBDIR)):
            for stem in sorted(folder.glob("*.wav")) if folder.is_dir() else []:
                try:
                    peaks.cached(stem, PEAKS_DIR / task_id / variant / f"{stem.stem}@100.json", points_per_second=100)
                except Exception as e:
                    print(f"Peaks warm-up failed for {task_id}/{stem.name}: {e}")

    threading.Thread(target=run, daemon=True).start()


def song_label(task: dict) -> str:
    """File-name-safe song name for downloads."""
    name = task.get("title") or Path(task.get("source_name") or "song").stem
    cleaned = "".join(c if c.isalnum() or c in " ._-()" else "_" for c in name).strip(" .")
    return cleaned[:120] or "song"


def download_youtube_audio(task_id: str, url: str, auto_split: bool = False):
    """Background task: download audio from YouTube URL; with auto_split the
    job is queued for separation as soon as the audio is in."""
    output_path = UPLOAD_DIR / f"{task_id}.%(ext)s"
    last_percent = [-1]

    def progress(d):
        # Throttled to whole 5 % steps: each update is a DB write.
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                percent = int(d.get("downloaded_bytes", 0) * 100 / total) // 5 * 5
                if percent != last_percent[0]:
                    last_percent[0] = percent
                    update_task(task_id, download_percent=percent)

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(output_path),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
        }],
        "quiet": True,
        "no_warnings": True,
        # A link copied from a Mix/playlist carries &list=…: only that video.
        "noplaylist": True,
        "progress_hooks": [progress],
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", "Unknown")
            duration = info.get("duration", 0)
            update_task(
                task_id,
                source_name=title,
                title=title,
                thumbnail=info.get("thumbnail", ""),
                duration=duration,
                duration_formatted=format_duration(duration),
            )

        wav_path = UPLOAD_DIR / f"{task_id}.wav"
        if wav_path.exists() and auto_split:
            task = get_task(task_id)
            update_task(task_id, file_path=str(wav_path), status="queued", download_percent=100)
            enqueue(task_id, wav_path, task["model"], task["recover"], task["recovery_model"])
        elif wav_path.exists():
            update_task(task_id, file_path=str(wav_path), status="downloaded", download_percent=100)
        else:
            update_task(task_id, status="download_failed", error="Audio conversion failed")
    except Exception as e:
        print(f"YouTube download failed for {task_id}: {e}")
        update_task(task_id, status="download_failed", error=str(e))


# Endpoints are plain `def`, not `async def`: they block (DB queries, file
# copies, yt-dlp network calls, ffmpeg), so FastAPI must run them in its
# threadpool — as `async def` they would stall the event loop and hold up
# every other request (e.g. status polling).
@app.post("/upload")
def upload_audio(
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    recover: bool = Form(False),
    recovery_model: str = Form(DEFAULT_MODEL),
):
    validate_settings(model, recover, recovery_model)

    task_id = str(uuid.uuid4())
    file_ext = Path(file.filename or "").suffix
    saved_filename = f"{task_id}{file_ext}"
    file_path = UPLOAD_DIR / saved_filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Reject non-audio and over-long files now, instead of a job that fails
    # later with a generic "Separation failed".
    try:
        if file_path.stat().st_size > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(status_code=413, detail=f"File is larger than {MAX_UPLOAD_MB:g} MB")
        duration = probe_audio(file_path)
        if duration > MAX_DURATION_SECONDS:
            raise HTTPException(
                status_code=400,
                detail=f"Audio exceeds maximum duration ({MAX_DURATION_SECONDS // 60} minutes)",
            )
    except HTTPException:
        file_path.unlink(missing_ok=True)
        raise

    create_task(
        task_id,
        kind="upload",
        status="queued",
        model=model,
        recover=recover,
        recovery_model=recovery_model,
        source_name=file.filename,
        file_path=str(file_path),
        duration=duration,
        duration_formatted=format_duration(int(duration)),
    )
    enqueue(task_id, file_path, model, recover, recovery_model)

    return {"task_id": task_id}


@app.post("/youtube/info")
def youtube_info(url: str = Form(...)):
    """Validate a YouTube URL and return video metadata without downloading."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video unavailable")

    if info.get("_type") == "playlist":
        raise HTTPException(status_code=400, detail="That is a playlist link; paste a single video's link")
    if info.get("is_live"):
        raise HTTPException(status_code=400, detail="Live streams are not supported")

    duration = info.get("duration", 0)
    if duration and duration > MAX_DURATION_SECONDS:
        raise HTTPException(
            status_code=400,
            detail=f"Video exceeds maximum duration ({MAX_DURATION_SECONDS // 60} minutes)"
        )

    return {
        "video_id": info.get("id"),
        "title": info.get("title", "Unknown"),
        "thumbnail": info.get("thumbnail", ""),
        "duration": duration,
        "duration_formatted": format_duration(duration),
    }


@app.post("/youtube/download")
def youtube_download(
    background_tasks: BackgroundTasks,
    url: str = Form(...),
    model: str = Form("htdemucs"),
    recover: bool = Form(False),
    recovery_model: str = Form(DEFAULT_MODEL),
    auto_split: bool = Form(False),
):
    """Start downloading audio from a YouTube URL in the background. With
    auto_split the separation is queued right after the download (no confirm
    step); otherwise the job waits as "downloaded" for /youtube/confirm."""
    validate_settings(model, recover, recovery_model)

    task_id = str(uuid.uuid4())
    create_task(
        task_id,
        kind="youtube",
        status="downloading",
        model=model,
        recover=recover,
        recovery_model=recovery_model,
        source_name=url,
    )
    background_tasks.add_task(download_youtube_audio, task_id, url, auto_split)
    return {"task_id": task_id}


@app.post("/youtube/confirm/{task_id}")
def youtube_confirm(task_id: str):
    """User confirms the downloaded audio — triggers Demucs processing."""
    task_info = get_task(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_info["status"] != "downloaded":
        raise HTTPException(status_code=400, detail="Audio not ready for confirmation")

    file_path = Path(task_info["file_path"])
    model = task_info["model"]
    recover = task_info.get("recover", False)
    recovery_model = task_info.get("recovery_model", DEFAULT_MODEL)
    update_task(task_id, status="queued")
    enqueue(task_id, file_path, model, recover, recovery_model)
    return {"status": "confirmed", "task_id": task_id}


@app.get("/youtube/preview/{task_id}")
def youtube_preview(task_id: str):
    """Serve the downloaded YouTube audio for preview playback."""
    task_info = get_task(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_info["status"] not in ("downloaded", "queued", "processing", "restoring", "completed"):
        raise HTTPException(status_code=400, detail="Audio not ready for preview")

    file_path = task_info.get("file_path")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(file_path, media_type="audio/wav")


@app.get("/tasks")
def get_tasks(
    limit: int = 50,
    before: str | None = None,
    q: str | None = None,
    status: str | None = None,
):
    """Recent jobs, newest first. Page back with `before` = the last row's
    created_at; `q` searches names; `status` is a comma-separated filter.
    `in_flight` counts every queued/running job (for a header badge)."""
    statuses = [s for s in (status or "").split(",") if s] or None
    rows = list_tasks(min(max(limit, 1), 200), before=before, q=q, statuses=statuses)
    return {
        "in_flight": count_in_flight(),
        "tasks": [
            {
                "task_id": t["id"],
                "kind": t["kind"],
                "status": t["status"],
                "name": t.get("title") or t["source_name"],
                "model": t["model"],
                "recover": t["recover"],
                "recovery_model": t["recovery_model"],
                "created_at": t["created_at"],
                "error": t.get("error"),
                "retry_of": t.get("retry_of"),
                "queue_position": jobs.queue_position(t["id"]) if t["status"] == "queued" else None,
                "duration": t.get("duration"),
                "bpm": t.get("bpm"),
                "key": t.get("song_key"),
                "started_at": t.get("started_at"),
                "finished_at": t.get("finished_at"),
                "step": t.get("step"),
                "step_index": t.get("step_index"),
                "step_total": t.get("step_total"),
                "current_stem": t.get("current_stem"),
                "download_percent": t.get("download_percent"),
            }
            for t in rows
        ]
    }


class RetryRequest(BaseModel):
    model: str = "htdemucs"
    recover: bool = False
    recovery_model: str = DEFAULT_MODEL


@app.post("/tasks/{task_id}/retry", status_code=201)
def retry_task(task_id: str, body: RetryRequest):
    """Run a finished job's source audio again with other settings, as a new
    job; the original job and its stems are kept."""
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    validate_settings(body.model, body.recover, body.recovery_model)
    src = task.get("file_path")
    if task["status"] in ("downloading", "download_failed") or not src or not Path(src).is_file():
        raise HTTPException(status_code=400, detail="The source audio for this job is no longer available")

    # The separators name their output after the input file's stem, and the
    # stems directory is keyed by task id — so the new job needs its own
    # <new id>.<ext> copy. A hard link costs no space where supported.
    new_id = str(uuid.uuid4())
    new_path = UPLOAD_DIR / f"{new_id}{Path(src).suffix}"
    try:
        os.link(src, new_path)
    except OSError:
        shutil.copy2(src, new_path)

    inherited = {
        k: task[k]
        for k in ("title", "thumbnail", "duration", "duration_formatted", "bpm", "song_key")
        if k in task
    }
    create_task(
        new_id,
        kind=task["kind"],
        status="queued",
        model=body.model,
        recover=body.recover,
        recovery_model=body.recovery_model,
        source_name=task["source_name"],
        file_path=str(new_path),
        retry_of=task["id"],
        **inherited,
    )
    enqueue(new_id, new_path, body.model, body.recover, body.recovery_model)
    return {"task_id": new_id}


@app.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: str):
    """Stop a queued or running job. Stems written so far are kept; the job
    ends as "cancelled" and can be retried or deleted."""
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] == "downloading":
        raise HTTPException(status_code=409, detail="A YouTube download can't be cancelled; delete the job once it finishes")
    if task["status"] not in IN_FLIGHT_STATUSES:
        raise HTTPException(status_code=409, detail="This job is not running")
    outcome = jobs.cancel(task_id)
    if outcome in ("dequeued", "not_found"):
        # Not on a worker (still waiting, or orphaned): it ends right here.
        update_task(task_id, status="cancelled", error="Cancelled")
    # "killed": the worker records "cancelled" once its subprocess exits.
    return {"status": "cancelled" if outcome != "killed" else "cancelling"}


@app.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: str):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task["status"] in IN_FLIGHT_STATUSES:
        raise HTTPException(status_code=409, detail="This job is still running")
    remove_task(task)
    return Response(status_code=204)


@app.get("/status/{task_id}")
def get_status(task_id: str):
    task_info = get_task(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    response = {"status": task_info["status"]}
    for key in (
        "error", "title", "thumbnail", "duration", "duration_formatted",
        "step", "step_index", "step_total", "current_stem",
        "recover", "recovery_model", "bpm",
        "created_at", "started_at", "finished_at", "download_percent", "model", "source_name",
    ):
        if key in task_info:
            response[key] = task_info[key]
    if task_info["status"] == "queued":
        response["queue_position"] = jobs.queue_position(task_id)
    return response


@app.get("/result/{task_id}")
def get_result(task_id: str):
    """
    Returns list of available tracks (and recovered variants, if any) for a
    completed task.
    """
    task_info = get_task(task_id)
    if not task_info or task_info["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task not completed or failed")

    demucs_out_dir = stems_dir(task_info)
    if not demucs_out_dir.exists():
        raise HTTPException(status_code=404, detail="Output directory not found")

    tracks = sorted(f.name for f in demucs_out_dir.glob("*.wav"))

    recovered_dir = demucs_out_dir / RECOVERED_SUBDIR
    recovered_tracks = sorted(f.name for f in recovered_dir.glob("*.wav")) if recovered_dir.exists() else []

    return {
        "tracks": tracks,
        # Mixes of the other stems (BS-Roformer's instrumental): playing them
        # with the rest doubles the instruments, so mixers mute them by default.
        "derived_tracks": [t for t in tracks if Path(t).stem in DERIVED_STEMS],
        "recovered_tracks": recovered_tracks,
        "recovered": len(recovered_tracks) > 0,
        "recovery_model": task_info.get("recovery_model"),
        "name": task_info.get("title") or task_info.get("source_name"),
        "model": task_info["model"],
        "recover": task_info.get("recover", False),
        # Jobs from before song analysis existed get analysed on first open.
        **_song_fields(task_info),
        "duration": _duration(task_info, demucs_out_dir, tracks),
    }


def _duration(task: dict, folder: Path, tracks: list[str]):
    """The source duration; jobs from before it was stored at upload get it
    from a stem (header read only) and keep it."""
    if task.get("duration") or not tracks:
        return task.get("duration")
    import soundfile as sf
    try:
        duration = round(sf.info(str(folder / tracks[0])).duration, 3)
    except Exception:
        return None
    update_task(task["id"], duration=duration)
    return duration


def _song_fields(task: dict) -> dict:
    song = song_analysis_or_start(task)
    return {"bpm": song["bpm"], "key": song["key"]}


def _resolve_track_path(task_id: str, track_name: str, variant: str) -> Path:
    task_info = get_task(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")

    file_path = track_path(task_info, track_name, variant)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Track not found")

    return file_path


@app.get("/download/{task_id}/{track_name}")
def download_track(task_id: str, track_name: str, variant: str = "original"):
    file_path = _resolve_track_path(task_id, track_name, variant)
    # "<song>-<stem>[-recovered].wav" for downloads; "inline" so the mixer's
    # <audio> elements still stream it (Range requests work as before).
    return FileResponse(
        file_path, media_type="audio/wav", headers=IMMUTABLE_CACHE_HEADERS,
        filename=_stem_filename(get_task(task_id), track_name, variant),
        content_disposition_type="inline",
    )


def _stem_filename(task: dict, track_name: str, variant: str) -> str:
    suffix = "-recovered" if variant == "recovered" else ""
    return f"{song_label(task)}-{Path(track_name).stem}{suffix}.wav"


@app.get("/peaks/{task_id}/{track_name}")
def get_peaks(
    task_id: str,
    track_name: str,
    variant: str = "original",
    resolution: int = Query(default=100, ge=10, le=peaks.MAX_POINTS_PER_SECOND),
):
    """Waveform peaks for a stem at `resolution` points per second, so the
    mixer can draw without downloading and decoding the WAV (see peaks.py).
    Pass them to wavesurfer as `peaks: [data.peaks]`, `duration: data.duration`."""
    file_path = _resolve_track_path(task_id, track_name, variant)
    cache = PEAKS_DIR / task_id / variant / f"{Path(track_name).stem}@{resolution}.json"
    data = peaks.cached(file_path, cache, points_per_second=resolution)
    return Response(content=json.dumps(data, separators=(",", ":")), media_type="application/json",
                    headers=IMMUTABLE_CACHE_HEADERS)


@app.get("/onsets/{task_id}/{track_name}")
def get_onsets(task_id: str, track_name: str, variant: str = "original"):
    """Transient (onset) times in seconds, for snapping selections to hits."""
    file_path = _resolve_track_path(task_id, track_name, variant)
    cache = PEAKS_DIR / task_id / variant / f"{Path(track_name).stem}.onsets.json"
    if cache.is_file():
        return Response(content=cache.read_text(), media_type="application/json", headers=IMMUTABLE_CACHE_HEADERS)
    import librosa
    y, sr = librosa.load(str(file_path), sr=22050, mono=True, res_type="kaiser_fast")
    times = librosa.onset.onset_detect(y=y, sr=sr, units="time", backtrack=True)
    body = json.dumps({"onsets": [round(float(t), 4) for t in times]}, separators=(",", ":"))
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(body)
    return Response(content=body, media_type="application/json", headers=IMMUTABLE_CACHE_HEADERS)


@app.get("/tasks/{task_id}/stems.zip")
def download_all_stems(task_id: str, variant: Literal["original", "recovered"] = "original"):
    """Every stem of a job (one variant) in a single zip, files named like
    the single-stem downloads. Stored, not deflated: WAV barely compresses."""
    task = get_task(task_id)
    if not task or task["status"] != "completed":
        raise HTTPException(status_code=404, detail="Task not found or not completed")
    base = stems_dir(task) / RECOVERED_SUBDIR if variant == "recovered" else stems_dir(task)
    stems = sorted(base.glob("*.wav"))
    if not stems:
        raise HTTPException(status_code=404, detail=f"No {variant} stems for this job")
    suffix = "-recovered" if variant == "recovered" else ""
    entries = [(stem, _stem_filename(task, stem.name, variant)) for stem in stems]
    # Streamed while it's written, so the download starts at once instead of
    # after building a few hundred MB on disk (26 s for 4 stems of a song).
    return StreamingResponse(
        _zip_stream(entries), media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{song_label(task)}-stems{suffix}.zip"'},
    )


class _QueueWriter(io.RawIOBase):
    """Write end of a bounded queue, for zipfile to write into."""

    def __init__(self, q: "queue.Queue"):
        self.q = q

    def writable(self):
        return True

    def write(self, b):
        self.q.put(bytes(b))
        return len(b)


def _zip_stream(entries):
    q: queue.Queue = queue.Queue(maxsize=16)  # ~16 MB of backpressure

    def produce():
        try:
            # An unseekable target makes zipfile write data descriptors,
            # which every unzip tool understands.
            with zipfile.ZipFile(_QueueWriter(q), "w", compression=zipfile.ZIP_STORED) as zf:
                for path, arcname in entries:
                    with open(path, "rb") as src, zf.open(arcname, "w", force_zip64=True) as dst:
                        shutil.copyfileobj(src, dst, 1024 * 1024)
        finally:
            q.put(None)

    threading.Thread(target=produce, daemon=True).start()
    while (chunk := q.get()) is not None:
        yield chunk


@app.get("/spectrogram/{task_id}/{track_name}")
def get_spectrogram(task_id: str, track_name: str, variant: str = "original"):
    """Render (and cache) a spectrogram PNG for a stem, so the UI can show
    the recovered high-frequency content instead of just claiming it exists."""
    file_path = _resolve_track_path(task_id, track_name, variant)

    cache_dir = SPECTROGRAM_DIR / task_id / variant
    cache_dir.mkdir(parents=True, exist_ok=True)
    png_path = cache_dir / f"{Path(track_name).stem}.png"

    if not png_path.exists():
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-i", str(file_path),
            "-lavfi", "showspectrumpic=s=800x400:legend=1",
            str(png_path),
        ]
        process = subprocess.run(cmd, capture_output=True, text=True)
        if process.returncode != 0 or not png_path.exists():
            raise HTTPException(status_code=500, detail="Failed to generate spectrogram")

    return FileResponse(png_path, media_type="image/png", headers=IMMUTABLE_CACHE_HEADERS)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
