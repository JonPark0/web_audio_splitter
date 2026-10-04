"""
Waveform peaks, precomputed server-side and cached on disk.

Drawing a waveform in the browser used to mean downloading and decoding the
whole file (a 6-minute stem is ~63 MB of WAV; a result screen has 4-14 of
them). With peaks the client draws immediately and the audio element
streams through HTTP Range requests instead.

Peaks are the max absolute sample value (all channels) per bucket, in 0..1,
rounded to 3 decimals to keep the JSON small.
"""
import json
import os
import uuid
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf

MAX_POINTS_PER_SECOND = 1000
BLOCK_SECONDS = 10


def compute(path: Path, points_per_second: Optional[float] = None, total_points: Optional[int] = None) -> dict:
    """Exactly one of points_per_second / total_points sets the resolution."""
    info = sf.info(str(path))
    duration = info.frames / info.samplerate
    if total_points:
        bucket = max(1, int(np.ceil(info.frames / total_points)))
    else:
        bucket = max(1, int(round(info.samplerate / (points_per_second or 100))))

    out = []
    # Whole buckets per block so no bucket straddles two reads.
    block = bucket * max(1, (BLOCK_SECONDS * info.samplerate) // bucket)
    for chunk in sf.blocks(str(path), blocksize=block, always_2d=True, dtype="float32"):
        mono_peak = np.abs(chunk).max(axis=1)
        pad = (-len(mono_peak)) % bucket
        if pad:
            mono_peak = np.concatenate([mono_peak, np.zeros(pad, dtype=np.float32)])
        out.append(mono_peak.reshape(-1, bucket).max(axis=1))
    values = np.concatenate(out) if out else np.zeros(0, dtype=np.float32)
    return {
        "duration": duration,
        "sample_rate": info.samplerate,
        "points_per_second": info.samplerate / bucket,
        "peaks": [round(float(v), 3) for v in np.clip(values, 0, 1)],
    }


def cached(path: Path, cache_path: Path, **resolution) -> dict:
    """compute(), memoised in cache_path (written atomically)."""
    if cache_path.is_file():
        try:
            return json.loads(cache_path.read_text())
        except (OSError, ValueError):
            pass  # corrupt or half-written by a crash: recompute
    data = compute(path, **resolution)
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_path.with_name(f".tmp_{uuid.uuid4()}.json")
    tmp.write_text(json.dumps(data, separators=(",", ":")))
    os.replace(tmp, cache_path)
    return data
