// Time / level / tempo formatting shared by the result screen.

export const MIN_DB = -48; // fader floor: silence (−∞)
export const MAX_DB = 6;

/** 83.4567 → "1:23.457" (ms precision); negative numbers keep a minus. */
export function fmtTime(sec, { ms = true } = {}) {
  if (!Number.isFinite(sec)) sec = 0;
  const neg = sec < 0;
  const total = Math.round(Math.abs(sec) * 1000);
  const m = Math.floor(total / 60000);
  const s = Math.floor(total / 1000) % 60;
  const rest = total % 1000;
  return `${neg ? '−' : ''}${m}:${String(s).padStart(2, '0')}${ms ? `.${String(rest).padStart(3, '0')}` : ''}`;
}

/** "1:23.457", "83.457", "1:23" → seconds; null when unreadable. */
export function parseTime(text) {
  const str = String(text ?? '').trim().replace(',', '.');
  if (!str) return null;
  const parts = str.split(':');
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  const sec = nums.reduce((acc, n) => acc * 60 + n, 0);
  return Number.isFinite(sec) && sec >= 0 ? sec : null;
}

/** 359.9 → "6:00" */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  return fmtTime(Math.round(sec), { ms: false });
}

export function dbToGain(db) {
  return db <= MIN_DB ? 0 : 10 ** (db / 20);
}

export function fmtDb(db) {
  if (db <= MIN_DB) return '−∞';
  if (Math.abs(db) < 0.05) return '0.0';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)}`;
}

/** Length in beats/bars at `bpm` (4/4): "2 bars", "1.50 beats". */
export function fmtBeats(lenSec, bpm) {
  if (!bpm || !(lenSec > 0)) return '';
  const beats = (lenSec * bpm) / 60;
  const rounded = Math.round(beats * 100) / 100;
  if (Math.abs(beats - Math.round(beats)) < 0.01) {
    const whole = Math.round(beats);
    if (whole % 4 === 0 && whole >= 4) return `${whole / 4} ${whole === 4 ? 'bar' : 'bars'}`;
    return `${whole} ${whole === 1 ? 'beat' : 'beats'}`;
  }
  return `${rounded.toFixed(2)} beats`;
}

export const stemLabel = (track) => track.replace(/\.wav$/i, '');

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
