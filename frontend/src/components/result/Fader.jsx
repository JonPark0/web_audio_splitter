import React from 'react';
import { MAX_DB, MIN_DB, fmtDb } from './format';

/**
 * Stem level in dB: −∞ … +6 dB, a detent at 0 dB (values within ±0.75 snap
 * to it) and double-click back to 0 dB. Boost above 0 dB is real gain (the
 * mix runs through Web Audio), and Save mix uses the same values.
 */
export default function Fader({ db, onChange, label, className = '', showValue = true }) {
  const set = (v) => {
    let next = v;
    if (Math.abs(next) <= 0.75) next = 0;
    if (next <= MIN_DB) next = MIN_DB;
    onChange(next);
  };
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <input
        type="range"
        min={MIN_DB}
        max={MAX_DB}
        step="0.5"
        value={db}
        onChange={(e) => set(parseFloat(e.target.value))}
        onDoubleClick={() => onChange(0)}
        className="slider rs-fader min-w-0 flex-1"
        title="Level — double-click for 0 dB"
        aria-label={`${label} level`}
        aria-valuetext={`${fmtDb(db)} dB`}
        style={{ '--rs-zero-frac': (0 - MIN_DB) / (MAX_DB - MIN_DB) }}
      />
      {showValue && (
        <span className="w-9 shrink-0 text-right text-caption tabular-nums" aria-hidden="true">
          {fmtDb(db)}
        </span>
      )}
    </div>
  );
}
