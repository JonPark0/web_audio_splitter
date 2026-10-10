import React, { useEffect, useRef, useState } from 'react';
import { isComposing, parseDecimal } from '../../keys';
import TextButton from '../TextButton';
import { BPM_MAX, BPM_MIN } from '../../samplesApi';
import { bpmSuggestions, formatBpm, roundBpm } from './format';
import { COARSE, TOUCH_TEXT } from './ui';

const TAP_RESET_MS = 2000; // idle gap that ends a tap run
const TAP_WINDOW = 8; // taps averaged
const TAP_MIN_TO_APPLY = 4; // 3 intervals - fewer is too jittery to save

const toDraft = (bpm) => (bpm == null ? '' : formatBpm(bpm));
const inRange = (v) => v >= BPM_MIN && v <= BPM_MAX;

/**
 * BPM with octave-error fixes: x2 / /2 on the effective value (disabled when
 * the result would leave the backend's 20-999 range, B5), a typed override,
 * tap tempo, whole-bar suggestions from the length (P9) and a reset back to
 * the detected value. Every change is a PATCH; the parent swaps in the
 * returned sample.
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
  // is mid-edit. Held while a PATCH is in flight; when `busy` clears it
  // re-syncs, which also undoes the draft if the PATCH failed.
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
    // "92,5" from a European keypad is 92.5
    const value = parseDecimal(draft);
    // Blank or out-of-range input just reverts; "reset" has its own control.
    if (!Number.isFinite(value) || !inRange(value)) {
      setDraft(toDraft(bpm));
      return;
    }
    setDraft(toDraft(roundBpm(value)));
    save(value);
  };

  // Unmounted mid-edit (sheet closed by a tap that doesn't blur on iOS, the
  // inspector swapped for a sheet at 1280 px): save what was typed. (A
  // field still in the page is StrictMode's rehearsal.)
  const fieldRef = useRef(null);
  const commitRef = useRef(commitDraft);
  commitRef.current = commitDraft;
  useEffect(
    () => () => {
      if (focusedRef.current && !fieldRef.current?.isConnected) commitRef.current();
    },
    []
  );

  const onKeyDown = (e) => {
    e.stopPropagation();
    if (isComposing(e)) return;
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      cancelRef.current = true;
      e.currentTarget.blur();
    }
  };

  const scaled = (factor) => (bpm == null ? null : roundBpm(bpm * factor));
  const canScale = (factor) => {
    const next = scaled(factor);
    return next != null && inRange(next);
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
      if (n >= TAP_MIN_TO_APPLY && inRange(tapped)) save(tapped);
    }, TAP_RESET_MS);
  };

  const tapLabel = !tap
    ? 'Tap'
    : tap.count < TAP_MIN_TO_APPLY
      ? `Tap ${tap.count}/${TAP_MIN_TO_APPLY}`
      : `Tap ${formatBpm(tap.bpm)}`;

  const suggestions = bpmSuggestions(sample.duration_sec, bpm);
  const btn = `text-caption ${COARSE}`;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* one line on every width: the ±/tap buttons are 44 px tall on touch,
          a second row of them would double the editor's height on phones */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-0">
        <label htmlFor={`bpm-${sample.id}`} className="-mr-1 w-10 shrink-0 text-caption text-muted">
          BPM
        </label>
        {/* text + decimal keypad, not type=number: that refuses "92,5"
            and a mouse wheel over the focused field changed the tempo
            while the inspector scrolled */}
        <input
          ref={fieldRef}
          id={`bpm-${sample.id}`}
          type="text"
          inputMode="decimal"
          value={draft}
          placeholder="—"
          disabled={busy}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          className={`ainput w-20 !pb-0.5 tabular-nums ${TOUCH_TEXT}`}
        />
        <TextButton disabled={busy || !canScale(2)} onClick={() => save(scaled(2))} title="Double the tempo" aria-label="Double BPM" className={btn}>
          ×2
        </TextButton>
        <TextButton disabled={busy || !canScale(0.5)} onClick={() => save(scaled(0.5))} title={canScale(0.5) || bpm == null ? 'Halve the tempo' : `Below ${BPM_MIN} BPM`} aria-label="Halve BPM" className={btn}>
          ÷2
        </TextButton>
        {/* Timed on press, not on click (release): the beat is when the
            finger lands, and how long it rests there varies tap to tap.
            Keyboard presses (a click with no pointer, detail 0) still count. */}
        <TextButton
          current={!!tap}
          disabled={busy}
          onPointerDown={(e) => e.button === 0 && onTap()}
          onClick={(e) => e.detail === 0 && onTap()}
          label="Tap 000.00"
          title="Tap along to the beat; saves 2 s after the last tap"
          className={`tabular-nums ${btn}`}
        >
          <span aria-live="polite">{tapLabel}</span>
        </TextButton>
      </div>
      {overridden && (
        <div className="flex flex-wrap items-center gap-x-4 pl-[52px] text-caption">
          <span className="text-muted">detected {formatBpm(detected)}</span>
          <TextButton disabled={busy} onClick={() => onPatch({ bpm: null })} title="Use the detected BPM" className={btn}>
            Reset
          </TextButton>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0 pl-[52px] text-caption">
          <span className="text-muted">Bars</span>
          {suggestions.map((s) => (
            <TextButton
              key={s.bars}
              disabled={busy}
              onClick={() => save(s.bpm)}
              title={`${s.bars} ${s.bars === 1 ? 'bar' : 'bars'} of 4/4 at ${formatBpm(s.bpm)} BPM`}
              aria-label={`Set ${formatBpm(s.bpm)} BPM (${s.bars} bars)`}
              className={`tabular-nums ${btn}`}
            >
              {`${formatBpm(s.bpm)} · ${s.bars}`}
            </TextButton>
          ))}
        </div>
      )}
    </div>
  );
}
