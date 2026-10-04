"""
Tempo and key estimation for library samples and whole songs (librosa,
already a dependency for the recovery wrappers).

Both are estimates for a sampling workflow, not ground truth: the UI lets
the user override each (see models.Sample), and returns None instead of a
number when the estimate would be meaningless.

A sample cut from a separated song inherits the song's tempo (estimated
once per job over the full mix): a few seconds of one stem are a much
weaker signal than the whole track, and on real material the per-sample
estimate landed on 4:3 / 3:2 relatives of the song tempo. Only samples with
no source song (imports) are tempo-estimated on their own.
"""
import numpy as np

ANALYSIS_SR = 22050
SONG_ANALYSIS_SR = 11025
# Beat tracking needs a few beats to lock onto; below this a "BPM" is noise.
MIN_BPM_SECONDS = 2.0
# Peak onset strength (spectral flux, in dB) below which the audio has no
# attacks to measure a tempo from: a sustained sine measured 0.1, real stems
# (incl. soft piano) 3+. The tempo estimator always returns *some* value (its
# 120 BPM prior), so this gate is what keeps a steady tone from getting one.
# (A peak/mean ratio was tried first and is anti-correlated with rhythm:
# dense drums have a high mean, so a real drum loop scored below a sine.)
MIN_ONSET_STRENGTH = 1.0
# Musically usable tempo range; estimates outside are folded in by octaves.
TEMPO_RANGE = (70.0, 180.0)
# Loops are cut on bar lines: a tempo candidate that makes an imported
# sample's length a whole number of 4-beat bars to within this fraction is
# taken over the raw estimate (which is often a 4:3 or 3:2 relative).
LOOP_FIT_TOLERANCE = 0.005
LOOP_MAX_SECONDS = 32.0
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


def analyze_file(path: str, bpm_hint=None) -> dict:
    """Return {"bpm": float|None, "key": str|None} for an audio file.

    bpm_hint: the source song's tempo, used as-is when given (see module
    docstring)."""
    import librosa  # heavy import (numba); only paid when analysis runs

    y, sr = librosa.load(path, sr=ANALYSIS_SR, mono=True)
    if y.size == 0 or not np.any(y):
        return {"bpm": bpm_hint, "key": None}

    if bpm_hint:
        bpm = round(float(bpm_hint), 2)
    else:
        bpm = _detect_bpm(librosa, y, sr, loop_fit=True) if y.size / sr >= MIN_BPM_SECONDS else None
    return {"bpm": bpm, "key": _detect_key(librosa, y, sr)}


def analyze_song(path: str) -> dict:
    """Tempo and key of a whole track (the original upload / mix).

    Tuned for speed on full songs (~7 s for 6 minutes, vs ~32 s with the
    sample settings): 11.025 kHz with fast resampling, and the key from a
    coarse-hop chroma of the whole mix without HPSS (a full mix is harmonic
    enough; HPSS alone took ~20 s). Same tempo and key as the slow path on
    the test song; a 60 s excerpt instead gave a different key.
    """
    import librosa

    y, sr = librosa.load(path, sr=SONG_ANALYSIS_SR, mono=True, res_type="kaiser_fast")
    if y.size == 0 or not np.any(y):
        return {"bpm": None, "key": None}
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048).mean(axis=1)
    return {"bpm": _detect_bpm(librosa, y, sr, loop_fit=False), "key": _best_key(chroma)}


def _detect_bpm(librosa, y: np.ndarray, sr: int, loop_fit: bool):
    # The onset-autocorrelation tempo estimate, i.e. the BPM beat_track would
    # report, without its beat-placement pass: the image pins librosa 0.9.2
    # (required by audiosr), whose beat trimming calls scipy.signal.hann,
    # removed in current scipy. `tempo` moved to librosa.feature in 0.10.
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    if onset_env.max() < MIN_ONSET_STRENGTH:
        return None
    tempo_fn = getattr(librosa.feature, "tempo", None) or librosa.beat.tempo
    tempo = float(np.atleast_1d(tempo_fn(onset_envelope=onset_env, sr=sr))[0])
    if tempo <= 0:
        return None

    duration = y.size / sr
    if loop_fit and duration <= LOOP_MAX_SECONDS:
        fitted = _loop_fit_tempo(tempo, duration)
        if fitted:
            return round(fitted, 2)

    lo, hi = TEMPO_RANGE
    while tempo < lo:
        tempo *= 2
    while tempo >= hi:
        tempo /= 2
    return round(tempo, 2)


def _loop_fit_tempo(tempo: float, duration: float):
    """The tempo among the estimate's common relatives that makes `duration`
    a whole number of bars, closest to the estimate; None if none fits."""
    best = None
    for factor in (1.0, 0.75, 4 / 3, 2 / 3, 1.5, 0.5, 2.0):
        candidate = tempo * factor
        if not TEMPO_RANGE[0] <= candidate < TEMPO_RANGE[1]:
            continue
        beats = duration * candidate / 60
        bars = round(beats / 4)
        if bars >= 1 and abs(beats - 4 * bars) / beats <= LOOP_FIT_TOLERANCE:
            distance = abs(np.log(candidate / tempo))
            if best is None or distance < best[0]:
                best = (distance, candidate)
    return best[1] if best else None


def _detect_key(librosa, y: np.ndarray, sr: int):
    harmonic, _ = librosa.effects.hpss(y)
    if np.sum(harmonic ** 2) < MIN_HARMONIC_RATIO * np.sum(y ** 2):
        return None

    # Chroma of the harmonic part only, so transients don't smear the
    # pitch-class profile.
    chroma = librosa.feature.chroma_cqt(y=harmonic, sr=sr).mean(axis=1)
    if not np.any(chroma):
        return None

    return _best_key(chroma)


def _best_key(chroma: np.ndarray):
    """Krumhansl-Kessler: the key whose profile best correlates with the
    mean chroma vector."""
    if not np.any(chroma):
        return None
    best_corr, best_key = -1.0, None
    for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
        for tonic in range(12):
            corr = np.corrcoef(chroma, np.roll(profile, tonic))[0, 1]
            if corr > best_corr:
                best_corr, best_key = corr, f"{PITCH_CLASSES[tonic]} {mode}"
    return best_key
