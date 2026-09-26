"""
Frequency-recovery dispatch module.

Split-only output can sound like it's missing frequency range for two
compounding reasons: the source is often already lossy (MP3/AAC/YouTube,
band-limited well below 20kHz) and separation itself further attenuates and
smears mid/high frequency content. This module restores that content on a
per-stem basis, after Demucs has produced the stems, using one of:

  - "apollo":  JusperLee/Apollo band-sequence restoration. Purpose-built for
               lossy-compressed music restoration; non-diffusion, so it is
               tolerable on CPU. Default / recommended.
  - "audiosr": haoheliu/versatile_audio_super_resolution, a diffusion-based
               any-sample-rate -> 48kHz super-resolution model. More
               powerful for true bandwidth extension, but much slower
               (measured ~15-35s/stem on a 15s clip on an RTX 4070 SUPER at the
               default 50 DDIM steps, plus ~30s to load the model per job); a GPU is strongly recommended.
  - "flashsr": jakeoneijk/FlashSR_Inference, a single-step diffusion-
               distilled any->48kHz model — the fast alternative to AudioSR
               (one forward pass per window instead of AudioSR's 10-50-step
               DDIM loop). No stated license and unverified specifically on
               music (its lineage, HierSpeech++, is speech-oriented), so
               it's offered alongside AudioSR rather than replacing it.

All three are invoked as subprocesses, matching the existing pattern this
project already uses for Demucs (backend/main.py's `process_audio`), which
keeps each model's dependency stack isolated from the FastAPI process. One
subprocess handles all of a job's stems so each model is loaded only once
(see infer_cli.py for the wrapper side of that protocol).
"""
import os
import subprocess
from collections import deque
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from infer_cli import MARKER

BASE_DIR = Path(__file__).parent

APOLLO_INFER_SCRIPT = BASE_DIR / "apollo_infer.py"
# apollo_infer.py downloads the checkpoint from this Hugging Face repo via
# huggingface_hub (resolving from the local cache when present). The image
# warms HF's cache with this same repo_id at build time (see
# backend/Dockerfile) so first use isn't a multi-minute cold download.
APOLLO_REPO_ID = os.getenv("APOLLO_REPO_ID", "JusperLee/Apollo")

AUDIOSR_INFER_SCRIPT = BASE_DIR / "audiosr_infer.py"
AUDIOSR_MODEL_NAME = os.getenv("AUDIOSR_MODEL_NAME", "basic")
AUDIOSR_DDIM_STEPS = os.getenv("AUDIOSR_DDIM_STEPS", "50")
AUDIOSR_GUIDANCE_SCALE = os.getenv("AUDIOSR_GUIDANCE_SCALE", "3.5")

FLASHSR_INFER_SCRIPT = BASE_DIR / "flashsr_infer.py"
FLASHSR_REPO_ID = os.getenv("FLASHSR_REPO_ID", "jakeoneijk/FlashSR_weights")

SUPPORTED_MODELS = ("apollo", "audiosr", "flashsr")
DEFAULT_MODEL = "apollo"

# Lines of subprocess output kept for the error message on failure.
ERROR_TAIL_LINES = 40


class RestoreError(RuntimeError):
    """Raised when a recovery subprocess fails or produces no output.

    `stem` names the stem being restored when it failed, if known."""

    def __init__(self, message: str, stem: Optional[str] = None):
        super().__init__(message)
        self.stem = stem


def restore_stems(
    pairs: List[Tuple[Path, Path]],
    model: str,
    device: str,
    on_stem_start: Optional[Callable[[int], None]] = None,
) -> None:
    """Restore each (in_path, out_path) pair, loading the model once.

    on_stem_start(i) is called as the subprocess begins stem i, for progress
    reporting. Raises RestoreError on failure; the caller (main.py) is
    expected to mark the task as failed and stop, leaving the un-restored
    original stems intact so the split-only result is never lost.
    """
    model = (model or DEFAULT_MODEL).lower()
    for _, out_path in pairs:
        out_path.parent.mkdir(parents=True, exist_ok=True)

    if model == "apollo":
        label = "Apollo"
        cmd = ["python", str(APOLLO_INFER_SCRIPT), "--device", device, "--repo_id", APOLLO_REPO_ID]
    elif model == "audiosr":
        label = "AudioSR"
        cmd = [
            "python", str(AUDIOSR_INFER_SCRIPT),
            "--device", device,
            "--model_name", AUDIOSR_MODEL_NAME,
            "--ddim_steps", str(AUDIOSR_DDIM_STEPS),
            "--guidance_scale", str(AUDIOSR_GUIDANCE_SCALE),
        ]
    elif model == "flashsr":
        label = "FlashSR"
        cmd = ["python", str(FLASHSR_INFER_SCRIPT), "--device", device, "--repo_id", FLASHSR_REPO_ID]
    else:
        raise RestoreError(
            f"Unknown recovery model '{model}'. Supported: {', '.join(SUPPORTED_MODELS)}"
        )

    for in_path, out_path in pairs:
        cmd += ["--in_wav", str(in_path), "--out_wav", str(out_path)]

    _run_batch(cmd, pairs, label, on_stem_start)


def _run_batch(cmd, pairs, label, on_stem_start) -> None:
    # stderr is merged into stdout so a single pipe is drained line by line —
    # reading two pipes sequentially could deadlock once the unread one fills.
    process = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1
    )
    tail = deque(maxlen=ERROR_TAIL_LINES)
    current = None
    for line in process.stdout:
        if line.startswith(MARKER):
            _, event, index = line.split()
            if event == "start":
                current = int(index)
                if on_stem_start:
                    on_stem_start(current)
        else:
            tail.append(line)
    process.wait()

    stem = pairs[current][0].stem if current is not None else None
    if process.returncode != 0:
        raise RestoreError(f"{label} restoration failed: {''.join(tail)[-2000:]}", stem=stem)

    missing = [out_path for _, out_path in pairs if not out_path.exists()]
    if missing:
        raise RestoreError(f"{label} did not produce an output file", stem=missing[0].stem)
