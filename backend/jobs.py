"""
Job runner for separation (+ recovery) jobs.

Jobs used to start immediately as FastAPI background tasks, so concurrent
uploads all ran on the GPU at once: three 15 s clips already peaked at
11.7 of 12 GB, and full songs would run out of memory. Jobs now go through
a FIFO queue drained by MAX_CONCURRENT_JOBS worker threads (default 1).

Cancellation: a queued job is simply dropped; a running job's subprocesses
(Demucs / BS-Roformer / the recovery wrappers) are killed. Code running in
a job registers its subprocesses through `run()` / `register()`, which find
the job via a thread-local, so the separation and recovery modules don't
need to know about task ids.
"""
import collections
import os
import signal
import subprocess
import threading
from contextlib import contextmanager
from typing import Callable, Optional

MAX_CONCURRENT_JOBS = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "1") or 1))


class JobCancelled(Exception):
    """Raised inside a job when it has been cancelled."""


_cv = threading.Condition()
_queue: collections.deque = collections.deque()  # (task_id, fn, args)
_running: dict[str, set] = {}  # task_id -> live Popen objects
_cancelled: set[str] = set()
_local = threading.local()
_started = False


def start() -> None:
    global _started
    with _cv:
        if _started:
            return
        _started = True
    for i in range(MAX_CONCURRENT_JOBS):
        threading.Thread(target=_worker, name=f"job-worker-{i}", daemon=True).start()


def submit(task_id: str, fn: Callable, *args) -> None:
    with _cv:
        _queue.append((task_id, fn, args))
        _cv.notify()


def queue_position(task_id: str) -> Optional[int]:
    """1-based position among jobs waiting to start, or None."""
    with _cv:
        for i, (tid, _, _) in enumerate(_queue):
            if tid == task_id:
                return i + 1
    return None


def queue_length() -> int:
    with _cv:
        return len(_queue)


def cancel(task_id: str) -> str:
    """Returns "dequeued", "killed" or "not_found"."""
    with _cv:
        for item in list(_queue):
            if item[0] == task_id:
                _queue.remove(item)
                return "dequeued"
        if task_id not in _running:
            return "not_found"
        _cancelled.add(task_id)
        procs = list(_running[task_id])
    for proc in procs:
        _kill(proc)
    return "killed"


def current_task() -> Optional[str]:
    return getattr(_local, "task_id", None)


def check_cancelled() -> None:
    task_id = current_task()
    if task_id is not None and task_id in _cancelled:
        raise JobCancelled(task_id)


@contextmanager
def register(proc: subprocess.Popen):
    """Track a subprocess of the current job so cancel() can kill it."""
    task_id = current_task()
    if task_id is None:
        yield proc
        return
    with _cv:
        _running.setdefault(task_id, set()).add(proc)
        cancelled = task_id in _cancelled
    if cancelled:
        _kill(proc)
    try:
        yield proc
    finally:
        with _cv:
            _running.get(task_id, set()).discard(proc)


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    """subprocess.run(cmd, capture_output=True, text=True), but cancellable.
    Raises JobCancelled if the job was cancelled while it ran."""
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
    )
    with register(proc):
        stdout, stderr = proc.communicate()
    check_cancelled()
    return subprocess.CompletedProcess(cmd, proc.returncode, stdout, stderr)


def _kill(proc: subprocess.Popen) -> None:
    # The separators spawn their own children; kill the whole process group
    # (each job subprocess starts its own session).
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, AttributeError):
        try:
            proc.terminate()
        except ProcessLookupError:
            pass


def _worker() -> None:
    while True:
        with _cv:
            while not _queue:
                _cv.wait()
            task_id, fn, args = _queue.popleft()
            _running[task_id] = set()
        _local.task_id = task_id
        try:
            fn(task_id, *args)
        except Exception as e:  # the job function reports its own errors
            print(f"Job {task_id} crashed: {e}")
        finally:
            _local.task_id = None
            with _cv:
                _running.pop(task_id, None)
                _cancelled.discard(task_id)
