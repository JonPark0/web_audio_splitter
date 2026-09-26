"""
On-disk layout under media/ and path helpers shared by the endpoints.
"""
from pathlib import Path
from typing import Optional

UPLOAD_DIR = Path("media/uploads")
OUTPUT_DIR = Path("media/separated")
SPECTROGRAM_DIR = Path("media/spectrograms")
SAMPLES_DIR = Path("media/samples")
for _d in (UPLOAD_DIR, OUTPUT_DIR, SPECTROGRAM_DIR, SAMPLES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

RECOVERED_SUBDIR = "recovered"
VARIANTS = ("original", "recovered")

# A task's stems, spectrograms and sample audio never change once written,
# so the browser can reuse them (e.g. when toggling original/recovered)
# without revalidating.
IMMUTABLE_CACHE_HEADERS = {"Cache-Control": "private, max-age=86400"}


def stems_dir(task: dict) -> Path:
    return OUTPUT_DIR / task["model"] / task["id"]


def track_path(task: dict, track_name: str, variant: str) -> Optional[Path]:
    """Path of one stem file, or None if it doesn't exist.

    track_name comes straight from the URL, so anything that isn't a bare
    file name (e.g. "../..") is rejected rather than joined onto the path.
    """
    if Path(track_name).name != track_name or variant not in VARIANTS:
        return None
    base = stems_dir(task)
    path = base / RECOVERED_SUBDIR / track_name if variant == "recovered" else base / track_name
    return path if path.is_file() else None
