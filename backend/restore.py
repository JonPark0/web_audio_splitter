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
               (measured ~70-90s/stem on a 12s clip at the default 50 DDIM
               steps); a GPU is strongly recommended.
  - "flashsr": jakeoneijk/FlashSR_Inference, a single-step diffusion-
               distilled any->48kHz model — the fast alternative to AudioSR
               (one forward pass per window instead of AudioSR's 10-50-step
               DDIM loop). No stated license and unverified specifically on
               music (its lineage, HierSpeech++, is speech-oriented), so
               it's offered alongside AudioSR rather than replacing it.

All three are invoked as subprocesses, matching the existing pattern this
project already uses for Demucs (backend/main.py's `process_audio`), which
keeps each model's dependency stack isolated from the FastAPI process.
"""
import os
import shutil
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).parent

APOLLO_INFER_SCRIPT = BASE_DIR / "apollo_infer.py"
# Apollo's own `BaseModel.from_pretrain(repo_id, ...)` fetches the checkpoint
# from this Hugging Face repo via huggingface_hub — there's no local
# checkpoint path to manage. The image warms HF's cache with this same
# repo_id at build time (see backend/Dockerfile) so first use isn't a
# multi-minute cold download.
APOLLO_REPO_ID = os.getenv("APOLLO_REPO_ID", "JusperLee/Apollo")

AUDIOSR_MODEL_NAME = os.getenv("AUDIOSR_MODEL_NAME", "basic")
AUDIOSR_DDIM_STEPS = os.getenv("AUDIOSR_DDIM_STEPS", "50")
AUDIOSR_GUIDANCE_SCALE = os.getenv("AUDIOSR_GUIDANCE_SCALE", "3.5")

FLASHSR_INFER_SCRIPT = BASE_DIR / "flashsr_infer.py"
FLASHSR_REPO_ID = os.getenv("FLASHSR_REPO_ID", "jakeoneijk/FlashSR_weights")

SUPPORTED_MODELS = ("apollo", "audiosr", "flashsr")
DEFAULT_MODEL = "apollo"


class RestoreError(RuntimeError):
    """Raised when a recovery subprocess fails or produces no output."""


def restore_stem(in_path: Path, out_path: Path, model: str, device: str) -> None:
    """Restore a single stem, writing the result to out_path.

    Raises RestoreError on failure; the caller (main.py) is expected to mark
    the task as failed and stop, leaving the un-restored original stem
    intact so the split-only result is never lost.
    """
    model = (model or DEFAULT_MODEL).lower()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if model == "apollo":
        _restore_apollo(in_path, out_path, device)
    elif model == "audiosr":
        _restore_audiosr(in_path, out_path, device)
    elif model == "flashsr":
        _restore_flashsr(in_path, out_path, device)
    else:
        raise RestoreError(
            f"Unknown recovery model '{model}'. Supported: {', '.join(SUPPORTED_MODELS)}"
        )


def _restore_apollo(in_path: Path, out_path: Path, device: str) -> None:
    cmd = [
        "python", str(APOLLO_INFER_SCRIPT),
        "--in_wav", str(in_path),
        "--out_wav", str(out_path),
        "--device", device,
        "--repo_id", APOLLO_REPO_ID,
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0 or not out_path.exists():
        raise RestoreError(f"Apollo restoration failed: {process.stderr[-2000:]}")


def _restore_audiosr(in_path: Path, out_path: Path, device: str) -> None:
    # The `audiosr` CLI writes into an output *directory* with a generated
    # filename, not an exact path — stage it in a scratch dir, then move the
    # single produced file into place (mirrors how get_result() in main.py
    # already globs Demucs' output directory).
    scratch_dir = out_path.parent / f".audiosr_tmp_{out_path.stem}"
    scratch_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        "audiosr",
        "-i", str(in_path),
        "-s", str(scratch_dir),
        "--model_name", AUDIOSR_MODEL_NAME,
        "-d", device,
        "--ddim_steps", str(AUDIOSR_DDIM_STEPS),
        "-gs", str(AUDIOSR_GUIDANCE_SCALE),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        shutil.rmtree(scratch_dir, ignore_errors=True)
        raise RestoreError(f"AudioSR restoration failed: {process.stderr[-2000:]}")

    # rglob, not glob: a real end-to-end run (recovery_model=audiosr) failed
    # here with "did not produce an output file" despite the subprocess
    # exiting 0, meaning the CLI wrote somewhere this glob didn't reach —
    # most likely a nested subdirectory under -s rather than directly into
    # it. rglob covers that nested case and the flat case alike.
    produced = sorted(scratch_dir.rglob("*.wav"))
    if not produced:
        shutil.rmtree(scratch_dir, ignore_errors=True)
        raise RestoreError("AudioSR did not produce an output file")

    shutil.move(str(produced[0]), str(out_path))
    shutil.rmtree(scratch_dir, ignore_errors=True)


def _restore_flashsr(in_path: Path, out_path: Path, device: str) -> None:
    cmd = [
        "python", str(FLASHSR_INFER_SCRIPT),
        "--in_wav", str(in_path),
        "--out_wav", str(out_path),
        "--device", device,
        "--repo_id", FLASHSR_REPO_ID,
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0 or not out_path.exists():
        raise RestoreError(f"FlashSR restoration failed: {process.stderr[-2000:]}")
