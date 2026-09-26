"""
Tempo and key estimation for library samples (librosa, already a
dependency for the recovery wrappers).

Both are estimates for a sampling workflow, not ground truth: the UI lets
the user override each (see models.Sample), and returns None instead of a
number when the estimate would be meaningless.
"""
import numpy as np

ANALYSIS_SR = 22050
# Beat tracking needs a few beats to lock onto; below this a "BPM" is noise.
MIN_BPM_SECONDS = 2.0
# The tempo estimator always returns *some* value (its 120 BPM prior), even
# for a sustained tone. Rhythmic audio has pronounced onset peaks relative to
# its average onset strength (real stems measured 12-23x); a steady tone sat
# around 5x. Below this ratio no BPM is reported. (Onset *counts* can't gate
# this: onset_detect normalizes, so a flat tone still yields dozens.)
MIN_ONSET_PEAK_RATIO = 8.0
# Share of signal energy in the harmonic (vs percussive) component below
# which no key is reported: drum stems measured 0.00-0.03, pitched stems
# (bass/piano/guitar/vocals) 0.08+. Profile correlation alone can't gate
# this — on real stems a drum track correlated *better* than the vocals.
MIN_HARMONIC_RATIO = 0.05

PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
VALID_KEYS = [f"{p} {mode}" for mode in ("major", "minor") for p in PITCH_CLASSES]

# Krumhansl-Kessler key profiles, tonic first (C major / C minor).
_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def analyze_file(path: str) -> dict:
    """Return {"bpm": float|None, "key": str|None} for an audio file."""
    import librosa  # heavy import (numba); only paid when analysis runs

    y, sr = librosa.load(path, sr=ANALYSIS_SR, mono=True)
    if y.size == 0 or not np.any(y):
        return {"bpm": None, "key": None}

    bpm = _detect_bpm(librosa, y, sr) if y.size / sr >= MIN_BPM_SECONDS else None
    return {"bpm": bpm, "key": _detect_key(librosa, y, sr)}


def _detect_bpm(librosa, y: np.ndarray, sr: int):
    # The onset-autocorrelation tempo estimate, i.e. the BPM beat_track would
    # report, without its beat-placement pass: the image pins librosa 0.9.2
    # (required by audiosr), whose beat trimming calls scipy.signal.hann,
    # removed in current scipy. `tempo` moved to librosa.feature in 0.10.
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    if onset_env.max() < MIN_ONSET_PEAK_RATIO * max(onset_env.mean(), 1e-9):
        return None
    tempo_fn = getattr(librosa.feature, "tempo", None) or librosa.beat.tempo
    tempo = float(np.atleast_1d(tempo_fn(onset_envelope=onset_env, sr=sr))[0])
    return round(tempo, 2) if tempo > 0 else None


def _detect_key(librosa, y: np.ndarray, sr: int):
    harmonic, _ = librosa.effects.hpss(y)
    if np.sum(harmonic ** 2) < MIN_HARMONIC_RATIO * np.sum(y ** 2):
        return None

    # Chroma of the harmonic part only, so transients don't smear the
    # pitch-class profile.
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr).mean(axis=1)
    if not np.any(chroma):
        return None

    best_corr, best_key = -1.0, None
    for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
        for tonic in range(12):
            corr = np.corrcoef(chroma, np.roll(profile, tonic))[0, 1]
            if corr > best_corr:
                best_corr, best_key = corr, f"{PITCH_CLASSES[tonic]} {mode}"
    return best_key
