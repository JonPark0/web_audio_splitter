// Grid, snapping and the single place pixels <-> beats are converted. Every
// component that positions something on the timeline goes through these.

export const ZOOM_LEVELS = [4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128]; // pixels per beat
export const DEFAULT_ZOOM = 24;
export const MIN_ZOOM = ZOOM_LEVELS[0];
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Zoom buttons step through ZOOM_LEVELS; wheel/pinch zoom is continuous, so
 * step to the next level strictly above (dir > 0) or below (dir < 0).
 */
export function stepZoom(z, dir) {
  const eps = 1e-6;
  if (dir > 0) return ZOOM_LEVELS.find((l) => l > z + eps) ?? MAX_ZOOM;
  return [...ZOOM_LEVELS].reverse().find((l) => l < z - eps) ?? MIN_ZOOM;
}

/** Lane heights the user can pick (desktop/tablet); phones use PHONE_LANE. */
export const LANE_HEIGHTS = [40, 64, 88];
export const DEFAULT_LANE = 64;
// Phone: the track name over a row of 44 px M/S (TrackHeader).
export const PHONE_LANE = 64;
export const RULER_HEIGHT = 28;
export const RULER_HEIGHT_TOUCH = 44; // the ruler is the only way to seek by touch
export const NEW_TRACK_ROW_HEIGHT = 44; // drop zone / "Add track" below the last track

/** Track header column width per layout (phone: 44 px M + S, then the meter). */
export const HEADER_WIDTH = { desktop: 192, tablet: 112, phone: 96 };

export const SNAP_OPTIONS = [
  { value: 'bar', label: '1 bar' },
  { value: '1', label: '1 beat' },
  { value: '0.5', label: '1/2' },
  { value: '0.25', label: '1/4' },
  { value: '0.125', label: '1/8' },
  { value: 'off', label: 'Off' },
];
export const DEFAULT_SNAP = '1';

/** Snap step in beats for a snap setting; 0 means free. */
export function snapStep(snap, beatsPerBar) {
  if (snap === 'off') return 0;
  if (snap === 'bar') return beatsPerBar;
  return Number(snap) || 0;
}

/**
 * Snap a beat to the grid. `round` for moving things (nearest line), `floor`
 * for "the cell under the pointer" (drops, seeks).
 */
export function snapBeat(beat, step, mode = 'round') {
  if (!step) return beat;
  const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
  // Tiny epsilon so 3.9999999 (float drift from px math) floors to 4.
  const eps = mode === 'floor' ? 1e-9 : mode === 'ceil' ? -1e-9 : 0;
  return fn(beat / step + eps) * step;
}

export function beatToPx(beat, pxPerBeat) {
  return beat * pxPerBeat;
}

export function pxToBeat(px, pxPerBeat) {
  return px / pxPerBeat;
}

/** "bar.beat.sixteenth", 1-based like a DAW transport. */
export function formatPosition(beat, beatsPerBar) {
  const b = Math.max(0, beat);
  const sixteenths = Math.floor(b * 4 + 1e-6);
  const bar = Math.floor(sixteenths / (beatsPerBar * 4)) + 1;
  const beatInBar = (Math.floor(sixteenths / 4) % beatsPerBar) + 1;
  const sub = (sixteenths % 4) + 1;
  return `${bar}.${beatInBar}.${sub}`;
}

/** Shorter "bar.beat" for labels (inspector, loop fields). */
export function formatBarBeat(beat, beatsPerBar) {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / beatsPerBar + 1e-9) + 1;
  const rest = Math.round((b - (bar - 1) * beatsPerBar) * 100) / 100 + 1;
  return `${bar}.${rest}`;
}

/**
 * Inverse of formatBarBeat: "3.2" -> beat 9 (4/4); "3" -> bar 3. null if
 * invalid. Commas count as dots ("3,2", "3,2,5"): European keypads have no '.'.
 */
export function parseBarBeat(text, beatsPerBar) {
  const m = String(text).trim().replace(/,/g, '.').match(/^(\d+)(?:\.(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  const bar = Number(m[1]);
  const beat = m[2] === undefined ? 1 : Number(m[2]);
  if (bar < 1 || beat < 1 || !Number.isFinite(beat)) return null;
  return (bar - 1) * beatsPerBar + (beat - 1);
}

export function formatBeats(beats) {
  return `${Math.round(beats * 100) / 100}`;
}

/** Linear gain -> "−6.0 dB" (−∞ at 0). */
export function formatDb(gain, digits = 1) {
  if (!(gain > 0)) return '−∞ dB';
  const db = 20 * Math.log10(gain);
  const r = Math.round(db * 10 ** digits) / 10 ** digits;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r).toFixed(digits)} dB`;
}

// Fader law for gain sliders: the slider runs in dB (MIN_DB at the bottom
// means silence), so equal travel is an equal loudness step.
export const MIN_DB = -60;
export function gainToDb(gain) {
  return gain > 0 ? Math.max(MIN_DB, 20 * Math.log10(gain)) : MIN_DB;
}
export function dbToGain(db) {
  return db <= MIN_DB + 1e-9 ? 0 : 10 ** (db / 20);
}

export function formatBpm(bpm) {
  if (bpm == null) return '—';
  return `${Math.round(bpm * 100) / 100}`;
}
