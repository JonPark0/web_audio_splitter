import React, { memo, useEffect, useRef, useState } from 'react';
import { engineCall } from './useEngine';

const INK = '#141414';
const MAX_BUCKETS = 65536;
const MIN_BUCKET_FRAMES = 64;
const MAX_CANVAS_PX = 16384; // browsers cap canvas size; beyond this we stretch

// Peaks are computed once per decoded buffer over the WHOLE source, and each
// clip slices its trim window out of them - so trimming or zooming only
// redraws, it never re-scans the audio. WeakMap: dropped with the buffer.
const peakCache = new WeakMap();

function getPeaks(buffer) {
  let peaks = peakCache.get(buffer);
  if (peaks) return peaks;
  const frames = buffer.length;
  const bucketFrames = Math.max(MIN_BUCKET_FRAMES, Math.ceil(frames / MAX_BUCKETS));
  const count = Math.max(1, Math.ceil(frames / bucketFrames));
  const min = new Float32Array(count).fill(1);
  const max = new Float32Array(count).fill(-1);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let b = 0; b < count; b++) {
      let lo = min[b];
      let hi = max[b];
      const end = Math.min(frames, (b + 1) * bucketFrames);
      for (let i = b * bucketFrames; i < end; i++) {
        const v = data[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[b] = lo;
      max[b] = hi;
    }
  }
  peaks = { min, max, count, bucketSec: bucketFrames / buffer.sampleRate };
  peakCache.set(buffer, peaks);
  return peaks;
}

// One getBuffer() promise per engine + sample, shared by every clip of it.
const bufferPromises = new WeakMap();

function loadBuffer(engine, sampleId) {
  let byId = bufferPromises.get(engine);
  if (!byId) {
    byId = new Map();
    bufferPromises.set(engine, byId);
  }
  if (!byId.has(sampleId)) {
    const p = engineCall(() => engine.getBuffer(sampleId));
    // Forget failures so a later mount (engine ready, network back) retries.
    p.catch(() => byId.delete(sampleId));
    byId.set(sampleId, p);
  }
  return byId.get(sampleId);
}

function draw(canvas, peaks, offsetSec, lengthSec, width, height) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = Math.max(1, Math.round(width));
  const pxW = Math.min(MAX_CANVAS_PX, Math.round(cssW * dpr));
  const pxH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== pxW) canvas.width = pxW;
  if (canvas.height !== pxH) canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, pxW, pxH);
  ctx.fillStyle = INK;

  const mid = pxH / 2;
  const startBucket = offsetSec / peaks.bucketSec;
  const bucketsPerPx = lengthSec / peaks.bucketSec / pxW;
  for (let x = 0; x < pxW; x++) {
    const from = Math.floor(startBucket + x * bucketsPerPx);
    const to = Math.max(from + 1, Math.floor(startBucket + (x + 1) * bucketsPerPx));
    let lo = 1;
    let hi = -1;
    for (let b = Math.max(0, from); b < Math.min(peaks.count, to); b++) {
      if (peaks.min[b] < lo) lo = peaks.min[b];
      if (peaks.max[b] > hi) hi = peaks.max[b];
    }
    if (hi < lo) continue; // past the end of the audio
    const top = mid - hi * mid;
    const h = Math.max(1, (hi - lo) * mid);
    ctx.fillRect(x, top, 1, h);
  }
}

/**
 * Waveform thumbnail for a clip's trimmed window of its sample. Renders
 * nothing until the engine hands over a decoded buffer, and stays empty if
 * it can't (the clip still shows its name).
 */
export default memo(function ClipWaveform({ engine, sampleId, offsetSec, lengthSec, width, height }) {
  const canvasRef = useRef(null);
  const [peaks, setPeaks] = useState(null);

  useEffect(() => {
    if (!engine) return undefined;
    let alive = true;
    loadBuffer(engine, sampleId)
      .then((buffer) => {
        if (alive && buffer && typeof buffer.getChannelData === 'function') setPeaks(getPeaks(buffer));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [engine, sampleId]);

  useEffect(() => {
    if (peaks && canvasRef.current && width > 0 && height > 0) {
      draw(canvasRef.current, peaks, offsetSec, lengthSec, width, height);
    }
  }, [peaks, offsetSec, lengthSec, width, height]);

  if (!peaks) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none block"
      style={{ width: Math.max(1, Math.round(width)), height }}
    />
  );
});
