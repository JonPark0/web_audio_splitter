import os
import shutil
import uuid
import subprocess
from pathlib import Path
from typing import List
from fastapi import FastAPI, UploadFile, File, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

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

def process_audio(task_id: str, file_path: Path):
    tasks[task_id] = "processing"
    output_path = OUTPUT_DIR / task_id
    
    # Demucs command
    # -n htdemucs: Uses the default high quality model
    # --out: Output directory
    cmd = ["demucs", "-n", "htdemucs", "--out", str(OUTPUT_DIR), str(file_path)]
    
    try:
        # Check if GPU is enabled via env var (passed to docker)
        # Demucs automatically uses GPU if available and pytorch is configured
        process = subprocess.run(cmd, capture_output=True, text=True)
        
        if process.returncode == 0:
            # Demucs creates a folder named after the track inside the model folder
            # We need to restructure or just know where it is.
            # Default structure: {out}/{model_name}/{track_name}/...
            # We will move files to a simpler structure or just update status.
            
            # Find the generated folder. It is usually the filename without extension.
            # But demucs might normalize the name.
            # Let's rely on finding the folder created in OUTPUT_DIR/htdemucs/
            
            filename_stem = file_path.stem
            # Demucs output path: OUTPUT_DIR / "htdemucs" / filename_stem
            # Note: filename_stem might be cleaned by demucs.
            
            # Simple workaround: Look for the folder in htdemucs
            demucs_out = OUTPUT_DIR / "htdemucs"
            
            # We need to correctly identify the output folder. 
            # For this MVP, let's assume standard behavior.
            # We'll store the exact output path in the task info if possible.
            
            tasks[task_id] = "completed"
        else:
            print(f"Error processing {task_id}: {process.stderr}")
            tasks[task_id] = "failed"
            
    except Exception as e:
        print(f"Exception for {task_id}: {e}")
        tasks[task_id] = "failed"

@app.post("/upload")
async def upload_audio(background_tasks: BackgroundTasks, file: UploadFile = File(...)):
    task_id = str(uuid.uuid4())
    file_ext = Path(file.filename).suffix
    saved_filename = f"{task_id}{file_ext}"
    file_path = UPLOAD_DIR / saved_filename
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    tasks[task_id] = "queued"
    background_tasks.add_task(process_audio, task_id, file_path)
    
    return {"task_id": task_id}

@app.get("/status/{task_id}")
async def get_status(task_id: str):
    status = tasks.get(task_id)
    if not status:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": status}

@app.get("/result/{task_id}")
async def get_result(task_id: str):
    """
    Returns list of available tracks for a completed task.
    """
    if tasks.get(task_id) != "completed":
        raise HTTPException(status_code=400, detail="Task not completed or failed")

    # Locate the output folder
    # Assuming standard htdemucs output. 
    # We need to find the folder that matches the uploaded file's stem (roughly)
    # Since we renamed the input file to task_id.ext, demucs will likely output to .../task_id/
    
    demucs_out_dir = OUTPUT_DIR / "htdemucs" / task_id
    
    if not demucs_out_dir.exists():
        # Fallback check or error
        return {"error": "Output directory not found"}
        
    tracks = [f.name for f in demucs_out_dir.glob("*.wav")]
    return {"tracks": tracks}

@app.get("/download/{task_id}/{track_name}")
async def download_track(task_id: str, track_name: str):
    demucs_out_dir = OUTPUT_DIR / "htdemucs" / task_id
    file_path = demucs_out_dir / track_name
    
    if not file_path.exists():
         raise HTTPException(status_code=404, detail="Track not found")
         
    return FileResponse(file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
