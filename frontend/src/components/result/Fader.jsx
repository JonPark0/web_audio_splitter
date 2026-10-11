import React, { useRef } from 'react';
import { useTouchSliderGuard } from '../../touchSlider';
import { MAX_DB, MIN_DB, fmtDb } from './format';

/**
 * Stem level in dB: −∞ … +6 dB, a detent at 0 dB while dragging (values
 * within ±0.75 snap to it) and back to 0 dB by double-click or the dB
 * readout, which is a button so touch can reach it too. Boost above 0 dB is
 * real gain (the mix runs through Web Audio), and Save mix uses the same
 * values.
 */
export default function Fader({ db, onChange, label, className = '', showValue = true }) {
  const dragging = useRef(false);
  const set = (v) => {
    let next = v;
    // Only under a finger or mouse: ←/→ and screen readers step 0.5 dB,
    // which the detent snapped straight back to 0.
    if (dragging.current && Math.abs(next) <= 0.75) next = 0;
    if (next <= MIN_DB) next = MIN_DB;
    onChange(next);
  };
  const grab = () => {
    dragging.current = true;
    const release = () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      // Firefox sets the value once more on mouseup, after pointerup: without
      // the detent that release left the fader at ±0.5 instead of 0.
      setTimeout(() => {
        dragging.current = false;
      });
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  };
  // A swipe that starts on the fader scrolls the page instead of moving it.
  const guard = useTouchSliderGuard(set, { onPointerDown: grab });
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <input
        type="range"
        min={MIN_DB}
        max={MAX_DB}
        step="0.5"
        value={db}
        {...guard}
        onDoubleClick={() => onChange(0)}
        className="slider rs-fader min-w-0 flex-1"
        title="Level — double-click for 0 dB"
        aria-label={`${label} level`}
        aria-valuetext={`${fmtDb(db)} dB`}
        style={{ '--rs-zero-frac': (0 - MIN_DB) / (MAX_DB - MIN_DB) }}
      />
      {showValue && (
        <button
          type="button"
          onClick={() => onChange(0)}
          title="Reset to 0 dB"
          aria-label={`Reset ${label} level to 0 dB`}
          className="weight-hover rs-hit w-9 shrink-0 text-right text-caption tabular-nums"
        >
          {fmtDb(db)}
        </button>
      )}
    </div>
  );
}
