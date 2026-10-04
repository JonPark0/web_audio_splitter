import React, { useEffect, useRef } from 'react';
import { useTimelineView, useViewFrame } from '../useWaveZoom';
import { clamp, fmtTime } from './format';

const TIME_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const BEAT_STEPS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256];

function timeLabel(t, step) {
  if (step >= 1) return fmtTime(t, { ms: false });
  const s = fmtTime(t);
  if (step >= 0.1) return s.slice(0, -2);
  if (step >= 0.01) return s.slice(0, -1);
  return s;
}

function beatLabel(b) {
  const bar = Math.floor(b / 4) + 1;
  const beat = (b % 4) + 1;
  if (Math.abs(b - Math.round(b)) > 1e-6) return `${bar}.${Math.floor(beat)}.${Math.round((beat % 1) * 4) + 1}`;
  return Math.round(beat) === 1 ? `${bar}` : `${bar}.${Math.round(beat)}`;
}

function draw(canvas, view, height, bpm, mode, selection) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(view.width * dpr);
  const H = Math.round(height * dpr);
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  if (!view.width || !(view.pps > 0)) return;
  const x = (t) => (t - view.start) * view.pps * dpr;
  if (selection) {
    ctx.fillStyle = 'rgba(20,20,20,0.1)';
    const a = Math.max(0, x(selection.start));
    const b = Math.min(W, x(selection.end));
    if (b > a) ctx.fillRect(a, 0, Math.max(dpr, b - a), H);
  }
  const visEnd = Math.min(view.duration, view.start + view.width / view.pps);
  const minSec = 72 / view.pps;
  let step;
  let label;
  let unit = 1;
  if (mode === 'bars' && bpm > 0) {
    unit = 60 / bpm;
    step = BEAT_STEPS.find((s) => s * unit >= minSec) || BEAT_STEPS[BEAT_STEPS.length - 1];
    label = (i) => beatLabel(i * step);
  } else {
    step = TIME_STEPS.find((s) => s >= minSec) || TIME_STEPS[TIME_STEPS.length - 1];
    label = (i) => timeLabel(i * step, step);
  }
  const stepSec = step * unit;
  const minor = stepSec / (step === 15 || step === 30 ? 3 : step === 0.25 || step === 0.5 ? 1 : 4);
  ctx.fillStyle = '#e7e7e4';
  for (let i = Math.ceil(view.start / minor); i * minor <= visEnd; i += 1) {
    ctx.fillRect(Math.round(x(i * minor)), H - 4 * dpr, dpr, 4 * dpr);
  }
  ctx.font = `${11 * dpr}px "Exo 2", system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  for (let i = Math.ceil(view.start / stepSec); i * stepSec <= visEnd; i += 1) {
    const px = Math.round(x(i * stepSec));
    ctx.fillStyle = '#141414';
    ctx.fillRect(px, H - 8 * dpr, dpr, 8 * dpr);
    ctx.fillStyle = '#8c8c8c';
    ctx.fillText(label(i), px + 3 * dpr, 2 * dpr);
  }
}

/**
 * Time ruler (bars.beats when the song's BPM is known and Bars is chosen)
 * over the lanes, plus an overview strip that shows and drags the visible
 * window when zoomed. Click/tap the ruler to seek; drag it to pan.
 */
export default function Ruler({ timeline, bpm, mode, selection, onSeek, height = 20, coarse }) {
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const wrapRef = useRef(null);

  useViewFrame(timeline, (v) => {
    if (canvasRef.current) draw(canvasRef.current, v, height, bpm, mode, selection);
    placeHead(timeline.getPlayhead(), v);
  }, [bpm, mode, selection?.start, selection?.end, height]);

  function placeHead(t, v = timeline.get()) {
    const el = headRef.current;
    if (!el) return;
    const px = (t - v.start) * v.pps;
    el.style.transform = `translateX(${px}px)`;
    el.style.visibility = px >= 0 && px <= v.width ? 'visible' : 'hidden';
  }
  useEffect(() => timeline.subscribeHead((t) => placeHead(t)), [timeline]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click = seek, drag = pan.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    let g = null;
    const down = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      g = { id: e.pointerId, x0: e.clientX, start0: timeline.get().start, moved: false };
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => {
      if (!g || e.pointerId !== g.id) return;
      if (Math.abs(e.clientX - g.x0) > 4) g.moved = true;
      if (g.moved && timeline.get().zoomed) timeline.panTo(g.start0 - (e.clientX - g.x0) / timeline.get().pps);
    };
    const up = (e) => {
      if (!g || e.pointerId !== g.id) return;
      if (!g.moved) {
        const r = el.getBoundingClientRect();
        onSeekRef.current(clamp(timeline.timeAt(e.clientX - r.left), 0, timeline.get().duration));
      }
      g = null;
    };
    const cancel = () => {
      g = null;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
    };
  }, [timeline]);
  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;

  return (
    <div>
      <div
        ref={wrapRef}
        className="relative cursor-pointer select-none overflow-hidden"
        style={{ height, touchAction: 'pan-y' }}
        title="Click to move the playhead"
      >
        <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
        <div ref={headRef} aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-px bg-ink" />
      </div>
      <Overview timeline={timeline} coarse={coarse} />
    </div>
  );
}

function Overview({ timeline, coarse }) {
  const view = useTimelineView(timeline);
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const W = view.width;
  const visible = view.width / view.pps;
  const thumbW = view.zoomed ? Math.max(16, (visible / view.duration) * W) : W;
  const thumbX = view.zoomed ? (view.start / Math.max(1e-9, view.duration - visible)) * (W - thumbW) : 0;

  const onDown = (e) => {
    if (!view.zoomed) return;
    const r = trackRef.current.getBoundingClientRect();
    const x = e.clientX - r.left;
    const onThumb = x >= thumbX && x <= thumbX + thumbW;
    if (!onThumb) {
      timeline.panTo(((x - thumbW / 2) / Math.max(1, W - thumbW)) * (view.duration - visible));
    }
    dragRef.current = { id: e.pointerId, x0: e.clientX, start0: timeline.get().start };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const v = timeline.get();
    const vis = v.width / v.pps;
    const tw = Math.max(16, (vis / v.duration) * v.width);
    timeline.panTo(d.start0 + ((e.clientX - d.x0) / Math.max(1, v.width - tw)) * (v.duration - vis));
  };
  const onUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      ref={trackRef}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      className={`relative ${view.zoomed ? 'cursor-pointer' : ''}`}
      style={{ height: coarse ? 14 : 8, touchAction: 'none' }}
      aria-hidden="true"
      title={view.zoomed ? 'Drag to scroll' : undefined}
    >
      <div className="absolute inset-x-0 top-1/2 h-px bg-line" />
      {view.zoomed && <div className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-ink" style={{ left: thumbX, width: thumbW }} />}
    </div>
  );
}
