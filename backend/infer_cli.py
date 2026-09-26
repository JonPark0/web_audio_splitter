"""
Shared CLI plumbing for the *_infer.py recovery wrappers.

Each wrapper restores *all* of a job's stems in one subprocess: loading a
recovery model (checkpoint read + weights to device) costs far more than
running it on a short stem — measured ~28s/stem for FlashSR on a 15s clip
with the GPU sitting at <10% utilization when a fresh process was spawned
per stem. So the model is loaded once and reused for every
`--in_wav/--out_wav` pair.

Per-stem progress is reported on stdout as marker lines
(`@@RESTORE start <i>` / `@@RESTORE done <i>`), which restore.py parses to
keep the frontend's per-stem progress display accurate. Everything else on
stdout/stderr is ordinary library output and is only kept for error
messages.
"""
import argparse
import sys

MARKER = "@@RESTORE"


def build_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    # Repeatable, paired by position: --in_wav a --out_wav a' --in_wav b --out_wav b'
    parser.add_argument("--in_wav", action="append", required=True)
    parser.add_argument("--out_wav", action="append", required=True)
    parser.add_argument("--device", default="cpu")
    return parser


def emit(event: str, index: int) -> None:
    print(f"{MARKER} {event} {index}", flush=True)


def run_batch(in_wavs, out_wavs, restore_one) -> None:
    """Call restore_one(in_wav, out_wav) for every pair, emitting progress
    markers. An exception aborts the batch with a non-zero exit (traceback on
    stderr); restore.py attributes it to the last stem that started."""
    if len(in_wavs) != len(out_wavs):
        sys.exit("--in_wav and --out_wav must be given the same number of times")

    for i, (in_wav, out_wav) in enumerate(zip(in_wavs, out_wavs)):
        emit("start", i)
        restore_one(in_wav, out_wav)
        emit("done", i)
