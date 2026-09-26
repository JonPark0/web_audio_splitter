// Display helpers shared by the library rows.

// m:ss.s - floor to tenths *before* splitting so 59.96 reads 0:59.9, not 0:59.10.
export function formatDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const tenths = Math.floor(sec * 10);
  const m = Math.floor(tenths / 600);
  const s = (tenths % 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

// m:ss, floored - for source region bounds.
export function formatClock(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  const whole = Math.floor(sec);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export function roundBpm(bpm) {
  return Math.round(bpm * 100) / 100;
}

// Up to 2 decimals, trailing zeros dropped (92, 91.5, 123.45).
export function formatBpm(bpm) {
  if (bpm == null || !Number.isFinite(bpm)) return '—';
  return String(roundBpm(bpm));
}

export function formatSource(source) {
  if (!source) return 'Imported';
  const track = (source.track || '').replace(/\.wav$/i, '');
  return [track, source.variant, `${formatClock(source.start_sec)}–${formatClock(source.end_sec)}`]
    .filter(Boolean)
    .join(' · ');
}

// Strip characters Windows/macOS refuse in file names.
export function downloadName(name) {
  const safe = (name || 'sample').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return `${safe || 'sample'}.wav`;
}
