import os
import shutil
import uuid
import subprocess
from pathlib import Path
from typing import List
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
import yt_dlp

app = FastAPI()

# CORS configuration
origins = ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = Path("media/uploads")
OUTPUT_DIR = Path("media/separated")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

MAX_DURATION_SECONDS = 1800  # 30 minutes

# In-memory storage for task status (in a real app, use Redis/DB)
tasks = {}


def format_duration(seconds: int) -> str:
    minutes, secs = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    if hours > 0:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def process_audio(task_id: str, file_path: Path, model: str):
    tasks[task_id]["status"] = "processing"

    shifts = int(os.getenv("DEMUCS_SHIFTS", 0))

    # Demucs command
    # -n: Model selection
    # --out: Output directory
    cmd = ["demucs", "-n", model, "--out", str(OUTPUT_DIR), str(file_path)]

    if shifts > 0:
        cmd.extend(["--shifts", str(shifts)])

    try:
        # Check if GPU is enabled via env var (passed to docker)
        # Demucs automatically uses GPU if available and pytorch is configured
        process = subprocess.run(cmd, capture_output=True, text=True)

        if process.returncode == 0:
            tasks[task_id]["status"] = "completed"
        else:
            print(f"Error processing {task_id}: {process.stderr}")
            tasks[task_id]["status"] = "failed"

    except Exception as e:
        print(f"Exception for {task_id}: {e}")
        tasks[task_id]["status"] = "failed"


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
            tasks[task_id]["title"] = info.get("title", "Unknown")
            tasks[task_id]["thumbnail"] = info.get("thumbnail", "")
            duration = info.get("duration", 0)
            tasks[task_id]["duration"] = duration
            tasks[task_id]["duration_formatted"] = format_duration(duration)

        wav_path = UPLOAD_DIR / f"{task_id}.wav"
        if wav_path.exists():
            tasks[task_id]["file_path"] = str(wav_path)
            tasks[task_id]["status"] = "downloaded"
        else:
            tasks[task_id]["status"] = "download_failed"
            tasks[task_id]["error"] = "Audio conversion failed"
    except Exception as e:
        print(f"YouTube download failed for {task_id}: {e}")
        tasks[task_id]["status"] = "download_failed"
        tasks[task_id]["error"] = str(e)


@app.post("/upload")
async def upload_audio(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Form("htdemucs")
):
    task_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    saved_filename = f"{task_id}{file_ext}"
    file_path = UPLOAD_DIR / saved_filename

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    tasks[task_id] = {
        "status": "queued",
        "model": model
    }
    background_tasks.add_task(process_audio, task_id, file_path, model)

    return {"task_id": task_id}


@app.post("/youtube/info")
async def youtube_info(url: str = Form(...)):
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
async def youtube_download(
    background_tasks: BackgroundTasks,
    url: str = Form(...),
    model: str = Form("htdemucs"),
):
    """Start downloading audio from a YouTube URL in the background."""
    task_id = str(uuid.uuid4())
    tasks[task_id] = {
        "status": "downloading",
        "model": model,
    }
    background_tasks.add_task(download_youtube_audio, task_id, url)
    return {"task_id": task_id}


@app.post("/youtube/confirm/{task_id}")
async def youtube_confirm(task_id: str, background_tasks: BackgroundTasks):
    """User confirms the downloaded audio — triggers Demucs processing."""
    task_info = tasks.get(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_info["status"] != "downloaded":
        raise HTTPException(status_code=400, detail="Audio not ready for confirmation")

    file_path = Path(task_info["file_path"])
    model = task_info["model"]
    tasks[task_id]["status"] = "queued"
    background_tasks.add_task(process_audio, task_id, file_path, model)
    return {"status": "confirmed", "task_id": task_id}


@app.get("/youtube/preview/{task_id}")
async def youtube_preview(task_id: str):
    """Serve the downloaded YouTube audio for preview playback."""
    task_info = tasks.get(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    if task_info["status"] not in ("downloaded", "queued", "processing", "completed"):
        raise HTTPException(status_code=400, detail="Audio not ready for preview")

    file_path = task_info.get("file_path")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    return FileResponse(file_path, media_type="audio/wav")


@app.get("/status/{task_id}")
async def get_status(task_id: str):
    task_info = tasks.get(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    response = {"status": task_info["status"]}
    for key in ("error", "title", "thumbnail", "duration", "duration_formatted"):
        if key in task_info:
            response[key] = task_info[key]
    return response

@app.get("/result/{task_id}")
async def get_result(task_id: str):
    """
    Returns list of available tracks for a completed task.
    """
    task_info = tasks.get(task_id)
    if not task_info or task_info["status"] != "completed":
        raise HTTPException(status_code=400, detail="Task not completed or failed")

    # Locate the output folder
    model = task_info["model"]
    demucs_out_dir = OUTPUT_DIR / model / task_id

    if not demucs_out_dir.exists():
        # Fallback check or error
        return {"error": "Output directory not found"}

    tracks = [f.name for f in demucs_out_dir.glob("*.wav")]
    return {"tracks": tracks}

@app.get("/download/{task_id}/{track_name}")
async def download_track(task_id: str, track_name: str):
    task_info = tasks.get(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")

    model = task_info["model"]
    demucs_out_dir = OUTPUT_DIR / model / task_id
    file_path = demucs_out_dir / track_name

    if not file_path.exists():
         raise HTTPException(status_code=404, detail="Track not found")

    return FileResponse(file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
