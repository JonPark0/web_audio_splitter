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
# Loops are cut on bar lines: for an imported clip, an estimate (or its
# octave) within this fraction of a tempo that makes the clip a whole number
# of 4-beat bars snaps to that exact tempo. Kept tight because any clip
# length fits *some* bar count: at 1.5 %, or with 4:3 / 3:2 relatives as
# candidates, 10 s clicks at 90 and 128 BPM snapped to 120 and 96. The
# estimator is accurate to ~0.3 %, so bar-exact loops still snap.
LOOP_FIT_TOLERANCE = 0.004
LOOP_MAX_SECONDS = 32.0
# Onset-envelope frame rate for tempo estimation. librosa's tempo() reads
# the tempo off an integer autocorrelation lag at 43 fps, so it can only
# return values on a grid (60*fps/lag): a 120 BPM click read 117.45 and
# every estimate was 1-6 % off, enough to drift a warped loop off the beat
# within a bar. A finer frame rate plus sub-lag interpolation and a
# refinement on the 2- and 4-beat lags lands within ~0.1 % on click tracks.
TEMPO_FPS = 172
# Prior over tempi when picking the beat lag (log-normal, as librosa's).
TEMPO_PRIOR_CENTER = 120.0
TEMPO_PRIOR_OCTAVES = 1.0
# Below this correlation with the best key profile the pitch content is too
# ambiguous to name a key (drum stems still leak some harmonic energy).
MIN_KEY_CORRELATION = 0.6
# A single sustained pitch (one chroma bin holding this share of the energy)
# has a note, not a key: a 440 Hz sine read "A minor".
MAX_SINGLE_PITCH_SHARE = 0.5
# Key analysis covers at most this much audio (the middle of longer clips):
# HPSS + CQT over a 3-minute sample took ~25 s.
KEY_MAX_SECONDS = 60.0
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


def analyze_file(path: str, bpm_hint=None, skip_key: bool = False) -> dict:
    """Return {"bpm": float|None, "key": str|None} for an audio file.

    bpm_hint: the source song's tempo, used as-is when given (see module
    docstring). skip_key: the material has no key (a drums stem)."""
    import librosa  # heavy import (numba); only paid when analysis runs

    y, sr = librosa.load(path, sr=ANALYSIS_SR, mono=True)
    if y.size == 0 or not np.any(y):
        return {"bpm": bpm_hint, "key": None}

    if bpm_hint:
        bpm = round(float(bpm_hint), 2)
    else:
        bpm = _detect_bpm(librosa, y, sr, loop_fit=True) if y.size / sr >= MIN_BPM_SECONDS else None
    key = None if skip_key else _detect_key(librosa, _middle(y, sr, KEY_MAX_SECONDS), sr)
    return {"bpm": bpm, "key": key}


def _middle(y: np.ndarray, sr: int, seconds: float) -> np.ndarray:
    n = int(seconds * sr)
    if y.size <= n:
        return y
    start = (y.size - n) // 2
    return y[start:start + n]


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
    # Attack gate on librosa's standard envelope (the threshold is calibrated
    # on its default hop; per-frame flux shrinks at finer hops).
    if librosa.onset.onset_strength(y=y, sr=sr).max() < MIN_ONSET_STRENGTH:
        return None
    tempo = _estimate_tempo(librosa, y, sr)
    if not tempo:
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


def _estimate_tempo(librosa, y: np.ndarray, sr: int):
    """Beat period from the onset envelope's autocorrelation, interpolated
    between lags and refined on the 2- and 4-beat lags (see TEMPO_FPS)."""
    hop = max(32, int(round(sr / TEMPO_FPS)))
    fps = sr / hop
    env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop)
    env = env - env.mean()
    if not np.any(env):
        return None
    max_lag = min(env.size - 2, int(fps * 60 / 40 * 4) + 2)
    ac = librosa.autocorrelate(env, max_size=max_lag + 2)

    lo, hi = int(fps * 60 / 240), min(int(fps * 60 / 40), ac.size - 2)
    if hi <= lo + 2:
        return None
    lags = np.arange(lo, hi)
    bpms = 60 * fps / lags
    prior = np.exp(-0.5 * ((np.log2(bpms) - np.log2(TEMPO_PRIOR_CENTER)) / TEMPO_PRIOR_OCTAVES) ** 2)
    beat_lag = _interpolated_peak(ac, int(np.argmax(ac[lo:hi] * prior)) + lo)
    tempo = 60 * fps / beat_lag

    # A peak k beats out measures the period k times more finely.
    for beats in (4, 2):
        target = beat_lag * beats
        if target * 1.03 + 2 < ac.size and target * 2 < env.size:
            a, b = int(target * 0.97), int(target * 1.03) + 1
            refined = 60 * fps * beats / _interpolated_peak(ac, int(np.argmax(ac[a:b])) + a)
            if abs(refined - tempo) / tempo < 0.03:
                return refined
    return tempo


def _interpolated_peak(values: np.ndarray, i: int) -> float:
    """Sub-sample position of the peak at index i (parabolic fit)."""
    if i <= 0 or i >= values.size - 1:
        return float(i)
    a, b, c = values[i - 1], values[i], values[i + 1]
    denom = a - 2 * b + c
    return i + (0.5 * (a - c) / denom if denom else 0.0)


def _loop_fit_tempo(tempo: float, duration: float):
    """The exact whole-bar tempo for `duration` nearest the estimate or its
    octaves (within LOOP_FIT_TOLERANCE); None if none fits."""
    best = None
    for factor in (1.0, 0.5, 2.0):
        candidate = tempo * factor
        if not TEMPO_RANGE[0] <= candidate < TEMPO_RANGE[1]:
            continue
        bars = round(duration * candidate / 240)
        if bars < 1:
            continue
        exact = 240 * bars / duration
        if abs(exact - candidate) / candidate <= LOOP_FIT_TOLERANCE:
            distance = abs(np.log(exact / tempo))
            if best is None or distance < best[0]:
                best = (distance, exact)
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
    if not np.any(chroma) or chroma.max() / chroma.sum() > MAX_SINGLE_PITCH_SHARE:
        return None
    best_corr, best_key = -1.0, None
    for mode, profile in (("major", _MAJOR_PROFILE), ("minor", _MINOR_PROFILE)):
        for tonic in range(12):
            corr = np.corrcoef(chroma, np.roll(profile, tonic))[0, 1]
            if corr > best_corr:
                best_corr, best_key = corr, f"{PITCH_CLASSES[tonic]} {mode}"
    return best_key if best_corr >= MIN_KEY_CORRELATION else None
