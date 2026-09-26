import asyncio
import os
import shutil
import uuid
import subprocess
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp

import projects
import samples
from restore import restore_stems, RestoreError, SUPPORTED_MODELS, DEFAULT_MODEL
from separate import separate_audio, SeparationError, DERIVED_STEMS, DEMUCS_MODELS, BS_ROFORMER_MODEL
from storage import (
    IMMUTABLE_CACHE_HEADERS, OUTPUT_DIR, RECOVERED_SUBDIR, SPECTROGRAM_DIR, UPLOAD_DIR,
    stems_dir, track_path,
)
from task_store import (
    IN_FLIGHT_STATUSES, create_task, delete_task_row, fail_interrupted_tasks, get_task,
    list_tasks, list_tasks_older_than, update_task,
)

SEPARATION_MODELS = DEMUCS_MODELS | {BS_ROFORMER_MODEL}
# Opt-in cleanup: jobs older than this many days have their uploaded audio,
# stems and spectrograms deleted (library samples are copies and survive).
# 0 / unset = keep everything.
MEDIA_RETENTION_DAYS = float(os.getenv("MEDIA_RETENTION_DAYS", "0") or 0)
RETENTION_CHECK_SECONDS = 6 * 3600


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Jobs whose worker thread died with the previous process would
    # otherwise show as running forever.
    interrupted = fail_interrupted_tasks()
    if interrupted:
        print(f"Marked {interrupted} interrupted task(s) as failed")
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
            update_task(task_id, status="failed", error="Separation failed")
            return

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

    except Exception as e:
        print(f"Exception for {task_id}: {e}")
        update_task(task_id, status="failed", error=str(e))


def download_youtube_audio(task_id: str, url: str):
    """Background task: download audio from YouTube URL."""
    output_path = UPLOAD_DIR / f"{task_id}.%(ext)s"
    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": str(output_path),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
        }],
        "quiet": True,
        "no_warnings": True,
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
        if wav_path.exists():
            update_task(task_id, file_path=str(wav_path), status="downloaded")
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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form("htdemucs"),
    recover: bool = Form(False),
    recovery_model: str = Form(DEFAULT_MODEL),
):
    if recover and recovery_model.lower() not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown recovery_model '{recovery_model}'")

    task_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    saved_filename = f"{task_id}{file_ext}"
    file_path = UPLOAD_DIR / saved_filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    create_task(
        task_id,
        kind="upload",
        status="queued",
        model=model,
        recover=recover,
        recovery_model=recovery_model,
        source_name=file.filename,
        file_path=str(file_path),
    )
    background_tasks.add_task(process_audio, task_id, file_path, model, recover, recovery_model)

    return {"task_id": task_id}


@app.post("/youtube/info")
def youtube_info(url: str = Form(...)):
    """Validate a YouTube URL and return video metadata without downloading."""
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        raise HTTPException(status_code=400, detail="Invalid YouTube URL or video unavailable")

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
):
    """Start downloading audio from a YouTube URL in the background."""
    if recover and recovery_model.lower() not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown recovery_model '{recovery_model}'")

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
    background_tasks.add_task(download_youtube_audio, task_id, url)
    return {"task_id": task_id}


@app.post("/youtube/confirm/{task_id}")
def youtube_confirm(task_id: str, background_tasks: BackgroundTasks):
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
    background_tasks.add_task(process_audio, task_id, file_path, model, recover, recovery_model)
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
def get_tasks(limit: int = 50):
    """Recent jobs, newest first, so the UI can reopen past results."""
    return {
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
            }
            for t in list_tasks(min(max(limit, 1), 200))
        ]
    }


class RetryRequest(BaseModel):
    model: str = "htdemucs"
    recover: bool = False
    recovery_model: str = DEFAULT_MODEL


@app.post("/tasks/{task_id}/retry", status_code=201)
def retry_task(task_id: str, body: RetryRequest, background_tasks: BackgroundTasks):
    """Run a finished job's source audio again with other settings, as a new
    job; the original job and its stems are kept."""
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if body.model not in SEPARATION_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown model '{body.model}'")
    if body.recover and body.recovery_model.lower() not in SUPPORTED_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown recovery_model '{body.recovery_model}'")
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

    inherited = {k: task[k] for k in ("title", "thumbnail", "duration", "duration_formatted") if k in task}
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
    background_tasks.add_task(process_audio, new_id, new_path, body.model, body.recover, body.recovery_model)
    return {"task_id": new_id}


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
        "recover", "recovery_model",
    ):
        if key in task_info:
            response[key] = task_info[key]
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
        "recovered_tracks": recovered_tracks,
        "recovered": len(recovered_tracks) > 0,
        "recovery_model": task_info.get("recovery_model"),
        "name": task_info.get("title") or task_info.get("source_name"),
    }


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
    return FileResponse(file_path, headers=IMMUTABLE_CACHE_HEADERS)


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
