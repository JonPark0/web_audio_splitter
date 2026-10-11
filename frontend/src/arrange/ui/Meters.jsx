import React, { useEffect, useMemo, useRef, useState } from 'react';

const FLOOR_DB = -60;
const RELEASE_PER_FRAME = 0.06; // fraction of the scale a meter may fall per frame
const FALL_FRAMES = Math.ceil(1 / RELEASE_PER_FRAME);
const CLIP_LEVEL = 0.999;

/** Linear peak -> 0..1 on a dB scale (FLOOR_DB .. 0 dBFS). */
function level(peak) {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB));
}

/**
 * Meter readings as a tiny pub/sub (like the position clock): one
 * requestAnimationFrame loop polls engine.getMeters() while playing and
 * pushes it to subscribers, which write to their own DOM nodes - nothing
 * re-renders per frame. Stopped: empty readings for as many frames as a
 * full-scale meter takes to fall, so every meter's release runs to rest.
 */
export function useMeterClock(engine, playing) {
  const listeners = useRef(new Set());
  const clock = useMemo(
    () => ({
      subscribe(fn) {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
    }),
    []
  );
  useEffect(() => {
    const emit = (m) => listeners.current.forEach((fn) => fn(m));
    let raf;
    if (!engine || !playing || typeof engine.getMeters !== 'function') {
      let left = FALL_FRAMES;
      const fall = () => {
        emit(null);
        if (--left > 0) raf = requestAnimationFrame(fall);
      };
      fall();
      return () => cancelAnimationFrame(raf);
    }
    const tick = () => {
      let m = null;
      try {
        m = engine.getMeters();
      } catch (e) {
        m = null;
      }
      emit(m);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [engine, playing]);
  return clock;
}

function useMeterListener(clock, pick, onLevel) {
  const fns = useRef({ pick, onLevel });
  fns.current = { pick, onLevel };
  useEffect(
    () =>
      clock.subscribe((m) => {
        const peaks = m ? fns.current.pick(m) : null;
        fns.current.onLevel(peaks);
      }),
    [clock]
  );
}

/**
 * Peak meter bar(s) in ink on a wash track. `vertical` for track headers,
 * horizontal (one row per channel) for the master. Falls back with a
 * release so it reads like a meter, not a flicker.
 */
export function MeterBar({ clock, pick, channels = 1, vertical = false, className = '', style, label }) {
  const bars = useRef([]);
  const shown = useRef([]);
  useMeterListener(clock, pick, (peaks) => {
    for (let ch = 0; ch < channels; ch++) {
      const target = peaks ? level(Array.isArray(peaks) ? peaks[ch] ?? 0 : peaks) : 0;
      const prev = shown.current[ch] || 0;
      const v = target >= prev ? target : Math.max(target, prev - RELEASE_PER_FRAME);
      if (v === prev || (Math.abs(v - prev) < 1e-3 && v !== 0)) continue;
      shown.current[ch] = v;
      const el = bars.current[ch];
      if (el) el.style.transform = vertical ? `scaleY(${v})` : `scaleX(${v})`;
    }
  });
  return (
    <span
      role="meter"
      aria-label={label}
      aria-valuemin={FLOOR_DB}
      aria-valuemax={0}
      className={`flex ${vertical ? 'flex-row gap-px' : 'flex-col gap-px'} ${className}`}
      style={style}
    >
      {Array.from({ length: channels }, (_, ch) => (
        <span key={ch} className="relative block flex-1 overflow-hidden bg-wash">
          <span
            ref={(el) => {
              bars.current[ch] = el;
            }}
            className={`absolute inset-0 bg-ink ${vertical ? 'origin-bottom' : 'origin-left'}`}
            style={{ transform: vertical ? 'scaleY(0)' : 'scaleX(0)' }}
          />
        </span>
      ))}
    </span>
  );
}

/** Latching clip light: shows "Clip" once any peak reaches 0 dBFS; click resets. */
export function ClipIndicator({ clock, pick, className = '' }) {
  const [clipped, setClipped] = useState(false);
  const latched = useRef(false);
  useMeterListener(clock, pick, (peaks) => {
    if (latched.current || !peaks) return;
    const list = Array.isArray(peaks) ? peaks : [peaks];
    if (list.some((p) => p >= CLIP_LEVEL)) {
      latched.current = true;
      setClipped(true);
    }
  });
  return (
    <button
      type="button"
      onClick={() => {
        latched.current = false;
        setClipped(false);
      }}
      title={clipped ? 'The mix reached 0 dBFS — click to reset' : 'Clip indicator'}
      aria-label={clipped ? 'Clipped — reset' : 'No clipping'}
      className={`border-0 bg-transparent p-0 text-caption leading-none ${clipped ? 'weight-up text-ink underline' : 'text-muted'} ${className}`}
    >
      {clipped ? 'Clip' : '0 dB'}
    </button>
  );
}
