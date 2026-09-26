import React, { memo, useRef, useState } from 'react';
import { RULER_HEIGHT, beatToPx, pxToBeat, snapBeat } from './snap';

const DRAG_THRESHOLD_PX = 3;
const MIN_LABEL_GAP_PX = 36;

/**
 * Bar/beat ruler. Click seeks (snapped); dragging across it draws a new
 * loop region (snapped) and enables the loop.
 */
export default memo(function Ruler({ pxPerBeat, beatsPerBar, totalBeats, loop, step, onSeek, onLoopChange }) {
  const ref = useRef(null);
  const [draft, setDraft] = useState(null); // {start, end} while dragging a loop

  const barPx = pxPerBeat * beatsPerBar;
  const bars = Math.ceil(totalBeats / beatsPerBar);
  // Label every Nth bar so numbers never collide when zoomed out.
  const labelEvery = [1, 2, 4, 8, 16].find((n) => n * barPx >= MIN_LABEL_GAP_PX) ?? 16;

  const beatAt = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    return Math.max(0, pxToBeat(clientX - rect.left, pxPerBeat));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const anchor = beatAt(x0);
    const loopStep = step || 0.25;
    let dragging = false;
    let current = null;

    const range = (clientX) => {
      const a = snapBeat(anchor, step);
      const b = snapBeat(beatAt(clientX), step);
      const start = Math.min(a, b);
      return { start, end: Math.max(Math.max(a, b), start + loopStep) };
    };

    const move = (ev) => {
      if (!dragging && Math.abs(ev.clientX - x0) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      current = range(ev.clientX);
      setDraft(current);
    };
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      setDraft(null);
      if (dragging) {
        const r = current || range(ev.clientX);
        onLoopChange({ enabled: true, start_beat: r.start, end_beat: r.end });
      } else {
        onSeek(snapBeat(anchor, step, 'round'));
      }
    };
    const cancel = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      setDraft(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  };

  const shownLoop = draft
    ? { start: draft.start, end: draft.end, enabled: true }
    : loop && loop.end_beat > loop.start_beat
      ? { start: loop.start_beat, end: loop.end_beat, enabled: loop.enabled }
      : null;

  const labels = [];
  for (let i = 0; i < bars; i += labelEvery) labels.push(i);

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      title="Click to move the playhead · drag to set the loop"
      className="relative cursor-pointer select-none border-b border-ink/60 text-caption"
      style={{
        height: RULER_HEIGHT,
        touchAction: 'none',
        // bar ticks full height, beat ticks along the bottom third
        backgroundImage: `linear-gradient(to right, rgba(20,20,20,0.35) 1px, transparent 1px), linear-gradient(to right, rgba(20,20,20,0.18) 1px, transparent 1px)`,
        backgroundSize: `${barPx}px 100%, ${pxPerBeat}px 33%`,
        backgroundPosition: '0 0, 0 100%',
        backgroundRepeat: 'repeat-x',
      }}
    >
      {shownLoop && (
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 ${
            shownLoop.enabled ? 'bg-ink/15' : 'border-x border-dashed border-ink/30 bg-ink/[0.04]'
          }`}
          style={{ left: beatToPx(shownLoop.start, pxPerBeat), width: beatToPx(shownLoop.end - shownLoop.start, pxPerBeat) }}
        />
      )}
      {labels.map((i) => (
        <span
          key={i}
          className="pointer-events-none absolute top-0.5 pl-1 leading-tight tabular-nums text-muted"
          style={{ left: beatToPx(i * beatsPerBar, pxPerBeat) }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
});
