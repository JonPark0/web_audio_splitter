import os
import shutil
import uuid
import subprocess
import torch
from pathlib import Path
from typing import List
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# GPU 사용 가능 여부 확인
if torch.cuda.is_available():
    print(f"✓ GPU 감지됨: {torch.cuda.get_device_name(0)}")
    print(f"  메모리: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
else:
    print("✗ GPU 사용 불가 - CPU 모드로 실행")

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

# In-memory storage for task status (in a real app, use Redis/DB)
tasks = {}

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

@app.get("/status/{task_id}")
async def get_status(task_id: str):
    task_info = tasks.get(task_id)
    if not task_info:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": task_info["status"]}

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
