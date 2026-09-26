import React, { useEffect, useRef, useState } from 'react';
import TextButton from '../TextButton';
import { formatBpm, roundBpm } from './format';

const MIN_BPM = 1;
const MAX_BPM = 999;
const TAP_RESET_MS = 2000; // idle gap that ends a tap run
const TAP_WINDOW = 8; // taps averaged
const TAP_MIN_TO_APPLY = 4; // 3 intervals - fewer is too jittery to save

const toDraft = (bpm) => (bpm == null ? '' : formatBpm(bpm));

/**
 * BPM with octave-error fixes: x2 / /2 on the effective value, a typed
 * override, tap tempo and a reset back to the detected value. Every change
 * is a PATCH; the parent swaps in the returned sample.
 */
export default function BpmControl({ sample, busy, onPatch }) {
  const { bpm, bpm_detected: detected, bpm_overridden: overridden } = sample;
  const [draft, setDraft] = useState(() => toDraft(bpm));
  const focusedRef = useRef(false);
  const cancelRef = useRef(false);

  const tapsRef = useRef([]);
  const tapTimerRef = useRef(null);
  const [tap, setTap] = useState(null); // { count, bpm } while tapping

  // Follow server changes (PATCH result, analysis finishing) unless the user
  // is mid-edit - polling every 2s would otherwise clobber their typing.
  // Held while a PATCH is in flight; when `busy` clears it re-syncs, which
  // also undoes the draft if the PATCH failed.
  useEffect(() => {
    if (!busy && !focusedRef.current) setDraft(toDraft(bpm));
  }, [bpm, busy]);

  useEffect(() => () => clearTimeout(tapTimerRef.current), []);

  const save = (value) => {
    const next = roundBpm(value);
    if (bpm != null && roundBpm(bpm) === next) return;
    onPatch({ bpm: next });
  };

  const commitDraft = () => {
    focusedRef.current = false;
    if (cancelRef.current) {
      cancelRef.current = false;
      setDraft(toDraft(bpm));
      return;
    }
    const value = Number(draft);
    // Blank or out-of-range input just reverts; "reset" has its own control.
    if (draft.trim() === '' || !Number.isFinite(value) || value < MIN_BPM || value > MAX_BPM) {
      setDraft(toDraft(bpm));
      return;
    }
    setDraft(toDraft(roundBpm(value)));
    save(value);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      cancelRef.current = true;
      e.currentTarget.blur();
    }
  };

  const scale = (factor) => {
    if (bpm == null) return;
    const next = roundBpm(bpm * factor);
    if (next < MIN_BPM || next > MAX_BPM) return;
    save(next);
  };

  const onTap = () => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length && now - taps[taps.length - 1] > TAP_RESET_MS) taps.length = 0;
    taps.push(now);
    if (taps.length > TAP_WINDOW) taps.shift();

    // Mean of successive intervals == span / (n - 1).
    const tapped = taps.length > 1 ? roundBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1))) : null;
    setTap({ count: taps.length, bpm: tapped });

    // Save once the run goes idle rather than PATCHing on every tap.
    clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      const n = tapsRef.current.length;
      tapsRef.current = [];
      setTap(null);
      if (n >= TAP_MIN_TO_APPLY && tapped >= MIN_BPM && tapped <= MAX_BPM) save(tapped);
    }, TAP_RESET_MS);
  };

  const tapLabel = !tap
    ? 'Tap'
    : tap.count < TAP_MIN_TO_APPLY
      ? `Tap ${tap.count}/${TAP_MIN_TO_APPLY}`
      : `Tap ${formatBpm(tap.bpm)}`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <label htmlFor={`bpm-${sample.id}`} className="text-caption text-muted">
          BPM
        </label>
        <input
          id={`bpm-${sample.id}`}
          type="number"
          inputMode="decimal"
          step="0.01"
          min={MIN_BPM}
          max={MAX_BPM}
          value={draft}
          placeholder="—"
          disabled={busy}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          className="ainput w-20 !pb-1 tabular-nums"
        />
        {overridden && (
          <span className="truncate text-caption text-muted">(detected {formatBpm(detected)})</span>
        )}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
        <TextButton muted disabled={busy || bpm == null} onClick={() => scale(2)} title="Double the tempo" aria-label="Double BPM">
          ×2
        </TextButton>
        <TextButton muted disabled={busy || bpm == null} onClick={() => scale(0.5)} title="Halve the tempo" aria-label="Halve BPM">
          ÷2
        </TextButton>
        <TextButton
          muted
          current={!!tap}
          disabled={busy}
          onClick={onTap}
          label="Tap 000.00"
          title="Tap along to the beat; saves 2s after the last tap"
          className="tabular-nums"
        >
          <span aria-live="polite">{tapLabel}</span>
        </TextButton>
        {overridden && (
          <TextButton muted disabled={busy} onClick={() => onPatch({ bpm: null })} title="Use the detected BPM">
            Reset
          </TextButton>
        )}
      </div>
    </div>
  );
}
