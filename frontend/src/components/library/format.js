// Display helpers shared by the library (and imported by Arrange:
// formatBpm, formatDuration - keep their signatures).

// m:ss.s - floor to tenths *before* splitting so 59.96 reads 0:59.9, not 0:59.10.
export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const tenths = Math.floor(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// Compact length for dense rows/cards: "1.0 s" under a minute, else m:ss.s.
export function formatLength(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  return sec < 60 ? `${(Math.floor(sec * 10) / 10).toFixed(1)} s` : formatDuration(sec);
}

// Region bounds read to the tenth (B9): a 0.4 s chop no longer shows 1:40–1:40.
export function formatClock(sec) {
  return formatDuration(sec);
}

export function roundBpm(bpm) {
  return Math.round(bpm * 100) / 100;
}

// Up to 2 decimals, trailing zeros dropped (92, 91.5, 123.45).
export function formatBpm(bpm) {
  if (bpm == null || !Number.isFinite(bpm)) return '—';
  return String(roundBpm(bpm));
}

// Camelot wheel: relative major/minor share a number (C maj 8B / A min 8A);
// each fifth up adds one (G maj 9B, D maj 10B ... F maj 7B).
const CAMELOT_MAJOR = { C: 8, G: 9, D: 10, A: 11, E: 12, B: 1, 'F#': 2, 'C#': 3, 'G#': 4, 'D#': 5, 'A#': 6, F: 7 };
const CAMELOT_MINOR = { A: 8, E: 9, B: 10, 'F#': 11, 'C#': 12, 'G#': 1, 'D#': 2, 'A#': 3, F: 4, C: 5, G: 6, D: 7 };

export function camelot(key) {
  const m = /^([A-G]#?) (major|minor)$/.exec(key || '');
  if (!m) return null;
  const n = (m[2] === 'major' ? CAMELOT_MAJOR : CAMELOT_MINOR)[m[1]];
  return n ? `${n}${m[2] === 'major' ? 'B' : 'A'}` : null;
}

// "E minor" → "E min"; with Camelot on → "9A · E min".
export function formatKey(key, { camelot: withCamelot = false } = {}) {
  if (!key) return '—';
  const short = key.replace(' major', ' maj').replace(' minor', ' min');
  const code = withCamelot ? camelot(key) : null;
  return code ? `${code} · ${short}` : short;
}

export function trackLabel(track) {
  return (track || '').replace(/\.wav$/i, '');
}

// "vocals · recovered · 3:20.0–3:21.5", or "Imported".
export function formatSource(source) {
  if (!source) return 'Imported';
  return [
    trackLabel(source.track),
    source.variant && source.variant !== 'original' ? source.variant : null,
    `${formatClock(source.start_sec)}–${formatClock(source.end_sec)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Strip characters Windows/macOS refuse in file names.
function safeName(name) {
  return (name || 'sample').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'sample';
}

// "<name>_<bpm>bpm_<key>.wav" (P4) - tempo and key travel with the file into
// any DAW's browser. "C# minor" → "C#min".
export function downloadName(sample) {
  const parts = [safeName(sample.name)];
  if (sample.bpm != null) parts.push(`${formatBpm(sample.bpm)}bpm`);
  if (sample.key) parts.push(sample.key.replace(' major', 'maj').replace(' minor', 'min').replace(/\s+/g, ''));
  return `${parts.join('_')}.wav`;
}

/**
 * Tempos at which the sample is a whole number of bars (P9), nearest the
 * current BPM first: a 5.2 s loop at "91" is probably 2 bars at 92.31.
 * Returns up to `count` { bpm, bars } with bpm in the 60-200 range (or the
 * full range around a current value outside it); none for one-shots.
 */
export function bpmSuggestions(durationSec, currentBpm, { beatsPerBar = 4, count = 3 } = {}) {
  if (!durationSec || durationSec < 1) return [];
  const lo = currentBpm && currentBpm < 60 ? 20 : 60;
  const hi = currentBpm && currentBpm > 200 ? 999 : 200;
  const out = [];
  for (let bars = 1; bars <= 64; bars += 1) {
    const bpm = roundBpm((60 * beatsPerBar * bars) / durationSec);
    if (bpm > hi) break;
    if (bpm >= lo) out.push({ bpm, bars });
  }
  const ref = currentBpm || 120;
  const pow2 = (n) => (n & (n - 1)) === 0;
  return out
    .filter((c) => !currentBpm || Math.abs(c.bpm - currentBpm) / currentBpm > 0.002)
    .sort((a, b) => {
      const d = Math.abs(Math.log(a.bpm / ref)) - Math.abs(Math.log(b.bpm / ref));
      // loops are usually 1/2/4/8 bars: prefer those on near-ties
      return Math.abs(d) < 0.05 ? Number(pow2(b.bars)) - Number(pow2(a.bars)) || d : d;
    })
    .slice(0, count);
}

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}
