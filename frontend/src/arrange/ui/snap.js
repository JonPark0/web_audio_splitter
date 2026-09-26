// Grid, snapping and the single place pixels <-> beats are converted. Every
// component that positions something on the timeline goes through these.

export const ZOOM_LEVELS = [8, 12, 16, 24, 32, 48, 64, 96]; // pixels per beat
export const DEFAULT_ZOOM = 24;

export const LANE_HEIGHT = 88; // px, one track row (header and lane alike)
export const RULER_HEIGHT = 28;
export const NEW_TRACK_ROW_HEIGHT = 48; // drop zone below the last track

export const SNAP_OPTIONS = [
  { value: 'bar', label: '1 bar' },
  { value: '1', label: '1 beat' },
  { value: '0.5', label: '1/2' },
  { value: '0.25', label: '1/4' },
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
  const fn = mode === 'floor' ? Math.floor : Math.round;
  // Tiny epsilon so 3.9999999 (float drift from px math) floors to 4.
  return fn(beat / step + (mode === 'floor' ? 1e-9 : 0)) * step;
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
  const beatInBar = Math.floor(sixteenths / 4) % beatsPerBar + 1;
  const sub = (sixteenths % 4) + 1;
  return `${bar}.${beatInBar}.${sub}`;
}

/** Shorter "bar.beat" for labels (inspector). */
export function formatBarBeat(beat, beatsPerBar) {
  const b = Math.max(0, beat);
  const bar = Math.floor(b / beatsPerBar + 1e-9) + 1;
  const rest = Math.round((b - (bar - 1) * beatsPerBar) * 100) / 100 + 1;
  return `${bar}.${rest}`;
}

export function formatBeats(beats) {
  return `${Math.round(beats * 100) / 100}`;
}
