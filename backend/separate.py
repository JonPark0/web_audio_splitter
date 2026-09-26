"""
Separation dispatch module.

Adds BS-Roformer (via the `bs-roformer-infer` pip package) as a second
separation engine alongside the existing Demucs CLI, without disturbing the
rest of the pipeline: both engines are made to produce the same
`out_dir/<model>/<task_id>/<stem>.wav` directory shape that main.py's
result/download/spectrogram endpoints and the recovery stage (restore.py)
already key off `task_info["model"]` to build — so none of that code needs
to know which engine actually produced the stems.
"""
import shutil
import subprocess
from pathlib import Path

DEMUCS_MODELS = {
    "htdemucs", "htdemucs_ft", "htdemucs_6s", "hdemucs_mmi",
    "mdx", "mdx_extra", "mdx_q", "mdx_extra_q", "SIG",
}
BS_ROFORMER_MODEL = "bs_roformer"


class SeparationError(RuntimeError):
    """Raised when a separation subprocess fails or produces no output."""


def separate_audio(file_path: Path, out_dir: Path, model: str, shifts: int, device: str) -> None:
    if model in DEMUCS_MODELS:
        _separate_demucs(file_path, out_dir, model, shifts)
    elif model == BS_ROFORMER_MODEL:
        _separate_bs_roformer(file_path, out_dir, device)
    else:
        raise SeparationError(f"Unknown separation model '{model}'")


def _separate_demucs(file_path: Path, out_dir: Path, model: str, shifts: int) -> None:
    # -n: Model selection, --out: Output directory. Demucs creates its own
    # out_dir/<model>/<input_stem>/*.wav layout — unchanged from the
    # original inline implementation this was extracted from.
    cmd = ["demucs", "-n", model, "--out", str(out_dir), str(file_path)]
    if shifts > 0:
        cmd.extend(["--shifts", str(shifts)])

    process = subprocess.run(cmd, capture_output=True, text=True)
    if process.returncode != 0:
        raise SeparationError(f"Demucs separation failed: {process.stderr[-2000:]}")


def _separate_bs_roformer(file_path: Path, out_dir: Path, device: str) -> None:
    # bs-roformer-infer's CLI works on a whole folder, not a single file —
    # stage the one input file in its own scratch folder, then move the
    # produced stems into the same out_dir/<model>/<task_id>/ shape Demucs
    # already uses (task_id == file_path.stem, since uploads are saved as
    # <task_id><ext> — see main.py's /upload).
    #
    # NOTE: no --device flag is documented for the CLI (only CUDA
    # auto-detection); `device` is accepted here for API symmetry with
    # _separate_demucs and future use, but isn't passed through yet —
    # confirmed empirically that this needs revisiting if auto-detection
    # doesn't pick the right device in practice.
    task_id = file_path.stem
    scratch_in = out_dir / f".bs_roformer_in_{task_id}"
    scratch_out = out_dir / f".bs_roformer_out_{task_id}"
    scratch_in.mkdir(parents=True, exist_ok=True)
    scratch_out.mkdir(parents=True, exist_ok=True)
    shutil.copy(file_path, scratch_in / file_path.name)

    cmd = [
        "bs-roformer-infer",
        "--input_folder", str(scratch_in),
        "--store_dir", str(scratch_out),
    ]
    process = subprocess.run(cmd, capture_output=True, text=True)

    if process.returncode != 0:
        shutil.rmtree(scratch_in, ignore_errors=True)
        shutil.rmtree(scratch_out, ignore_errors=True)
        raise SeparationError(f"BS-Roformer separation failed: {process.stderr[-2000:]}")

    # rglob defensively: exact nesting under store_dir isn't documented —
    # the same category of gap that made AudioSR's output land in a nested
    # timestamped folder (see restore.py's _restore_audiosr). Don't trust
    # a flat glob until proven.
    produced = sorted(scratch_out.rglob("*.wav"))
    if not produced:
        shutil.rmtree(scratch_in, ignore_errors=True)
        shutil.rmtree(scratch_out, ignore_errors=True)
        raise SeparationError("BS-Roformer did not produce any output files")

    final_dir = out_dir / BS_ROFORMER_MODEL / task_id
    final_dir.mkdir(parents=True, exist_ok=True)
    # bs-roformer-infer names outputs "<input_stem>_<stem>.wav" (e.g.
    # "<task_id>_vocals.wav") — confirmed by a real run. Strip that prefix
    # so filenames match Demucs' plain "vocals.wav" convention; the
    # frontend derives its display label directly from the filename.
    prefix = f"{task_id}_"
    for f in produced:
        name = f.name[len(prefix):] if f.name.startswith(prefix) else f.name
        shutil.move(str(f), str(final_dir / name))

    shutil.rmtree(scratch_in, ignore_errors=True)
    shutil.rmtree(scratch_out, ignore_errors=True)
