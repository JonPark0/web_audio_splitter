import { errorDetail, getPeaks } from '../../api';

/**
 * Server-side waveform peaks (max |sample| per bucket, 0..1) at a few
 * resolutions: 100 points/s on open (~100-200 KB per 6-min stem), 400 and
 * 1000 fetched lazily once the zoom outgrows the coarser level.
 */
export const BASE_LEVEL = 100;
const LEVELS = [100, 400, 1000];

export function createPeaksStore(taskId) {
  const cache = new Map();
  const listeners = new Set();
  const notify = (track) => listeners.forEach((fn) => fn(track));
  const key = (track, variant, res) => `${track}|${variant}|${res}`;

  function load(track, variant = 'original', res = BASE_LEVEL) {
    const k = key(track, variant, res);
    let entry = cache.get(k);
    if (entry && entry.state !== 'error') return entry.promise;
    entry = { state: 'loading', res };
    cache.set(k, entry);
    entry.promise = getPeaks(taskId, track, variant, res).then(
      (r) => {
        const d = r.data;
        const data = Float32Array.from(d.peaks || []);
        let max = 0;
        for (let i = 0; i < data.length; i += 1) if (data[i] > max) max = data[i];
        Object.assign(entry, {
          state: 'ready',
          data,
          pps: d.points_per_second || res,
          duration: d.duration,
          sampleRate: d.sample_rate,
          max,
        });
        notify(track);
        return entry;
      },
      (err) => {
        entry.state = 'error';
        entry.error = errorDetail(err, 'Could not load the waveform');
        notify(track);
        throw err;
      }
    );
    entry.promise.catch(() => {});
    notify(track);
    return entry.promise;
  }

  return {
    load,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Base (100 pps) entry: { state, error, max, duration, sampleRate } or undefined. */
    base: (track, variant) => cache.get(key(track, variant, BASE_LEVEL)),
    /**
     * The best ready level for drawing at `devPxPerSec`; asks for a finer one
     * when the zoom has outgrown what's loaded.
     */
    pick(track, variant, devPxPerSec) {
      const want = LEVELS.find((l) => l >= devPxPerSec * 0.75) || LEVELS[LEVELS.length - 1];
      const wantEntry = cache.get(key(track, variant, want));
      if (!wantEntry) load(track, variant, want);
      if (wantEntry?.state === 'ready') return wantEntry;
      // Best fallback: the finest ready level.
      for (let i = LEVELS.length - 1; i >= 0; i -= 1) {
        const e = cache.get(key(track, variant, LEVELS[i]));
        if (e?.state === 'ready') return e;
      }
      return null;
    },
    retry(track, variant) {
      LEVELS.forEach((l) => {
        const e = cache.get(key(track, variant, l));
        if (e?.state === 'error') cache.delete(key(track, variant, l));
      });
      return load(track, variant, BASE_LEVEL);
    },
  };
}

/**
 * Continuous min/max waveform of the visible window (P9): one filled shape,
 * one device pixel per column, the max over every bucket a column covers —
 * no bars or gaps, so a single-bucket transient still shows. Peaks are
 * |sample| maxima, so the shape is mirrored around the centre line.
 * `scale` multiplies amplitude (1/max for per-stem normalising, 1/globalMax
 * for the shared scale).
 */
export function drawPeaks(ctx, level, view, W, H, dpr, scale, color) {
  ctx.clearRect(0, 0, W, H);
  if (!level || !level.data.length || !(view.pps > 0)) return;
  const { data } = level;
  const lp = level.pps;
  const n = data.length;
  const secPerPx = 1 / (view.pps * dpr);
  const mid = H / 2;
  const amp = (H / 2 - dpr) * scale;
  const minH = 0.5 * dpr;
  const endX = Math.min(W, Math.ceil((n / lp - view.start) / secPerPx));
  if (endX <= 0) return;
  const tops = new Float32Array(endX);
  for (let x = 0; x < endX; x += 1) {
    const b0 = (view.start + x * secPerPx) * lp;
    const b1 = b0 + secPerPx * lp;
    let v = 0;
    if (b1 - b0 >= 1) {
      const i0 = Math.max(0, Math.floor(b0));
      const i1 = Math.min(n, Math.ceil(b1));
      for (let i = i0; i < i1; i += 1) if (data[i] > v) v = data[i];
    } else {
      // Zoomed past the data: interpolate between bucket centres.
      const c = (b0 + b1) / 2 - 0.5;
      const i = Math.floor(c);
      const f = c - i;
      const a = data[Math.min(n - 1, Math.max(0, i))];
      const b = data[Math.min(n - 1, Math.max(0, i + 1))];
      v = a + (b - a) * f;
    }
    tops[x] = Math.min(mid, Math.max(minH, v * amp));
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, mid - tops[0]);
  for (let x = 1; x < endX; x += 1) ctx.lineTo(x, mid - tops[x]);
  ctx.lineTo(endX, mid - tops[endX - 1]);
  ctx.lineTo(endX, mid + tops[endX - 1]);
  for (let x = endX - 1; x >= 0; x -= 1) ctx.lineTo(x, mid + tops[x]);
  ctx.closePath();
  ctx.fill();
}
