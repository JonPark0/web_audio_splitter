"""
Song-level analysis of a job's source audio (tempo and key of the full mix),
computed once and stored in the job's meta as `bpm` / `song_key`.

Samples cut from the job inherit this tempo (see analysis.py), and the
result screen shows it.
"""
import threading
from pathlib import Path

import analysis
from task_store import update_task

# Bump when the estimator changes, so stored results from an older one are
# recomputed on next use (v1 read tempi off librosa's coarse lag grid, e.g.
# 92.29 for a 91.0 BPM song).
SONG_ANALYSIS_VERSION = 2

_pending: set[str] = set()
_lock = threading.Lock()


def _is_current(task: dict) -> bool:
    return "bpm" in task and task.get("song_analysis_version") == SONG_ANALYSIS_VERSION


def ensure_song_analysis(task: dict) -> dict:
    """{"bpm", "key"} for the job's source audio, analysing it on first use."""
    if _is_current(task):  # analysed already (bpm may legitimately be None)
        return {"bpm": task.get("bpm"), "key": task.get("song_key")}
    path = task.get("file_path")
    if not path or not Path(path).is_file():
        return {"bpm": None, "key": None}
    try:
        result = analysis.analyze_song(path)
    except Exception as e:
        print(f"Song analysis failed for {task['id']}: {e}")
        result = {"bpm": None, "key": None}
    update_task(task["id"], bpm=result["bpm"], song_key=result["key"], song_analysis_version=SONG_ANALYSIS_VERSION)
    return result


def song_analysis_or_start(task: dict) -> dict:
    """The stored analysis, or {None, None} while it runs in the background
    (for request handlers that must not wait ~7 s on an old job)."""
    if _is_current(task):
        return {"bpm": task.get("bpm"), "key": task.get("song_key")}
    with _lock:
        if task["id"] in _pending:
            return {"bpm": None, "key": None}
        _pending.add(task["id"])

    def run():
        try:
            ensure_song_analysis(task)
        finally:
            with _lock:
                _pending.discard(task["id"])

    threading.Thread(target=run, daemon=True).start()
    return {"bpm": None, "key": None}
