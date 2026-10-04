import React, { memo, useRef } from 'react';
import { FiMoreHorizontal } from 'react-icons/fi';
import TextButton from '../TextButton';
import PreviewProgress from './PreviewProgress';
import RowError from './RowError';
import { PlayGlyph, StatusNote } from './SampleRow';
import { formatBpm, formatKey, formatLength } from './format';

const LONG_PRESS_MS = 450;

/**
 * Phone card, 64 px: play (44) | name over "1.0 s · 91 · E min · drums" |
 * ⋯ (44). Tapping the card plays it; long-press (or "Select" in the action
 * sheet) starts multi-select - the touch stand-in for checkboxes and
 * Shift-click. Everything else is in the ⋯ action sheet.
 */
export default memo(function SampleCard({ sample, selected, checked, selecting, playing, loading, error, busy, camelot, audioRef, ctx }) {
  const id = sample.id;
  const pressRef = useRef(null);
  const longPressedRef = useRef(false);
  const meta = [
    formatLength(sample.duration_sec),
    sample.bpm != null ? formatBpm(sample.bpm) : null,
    sample.key ? formatKey(sample.key, { camelot }) : null,
    (sample.tags || []).join(', ') || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const startPress = () => {
    longPressedRef.current = false;
    clearTimeout(pressRef.current);
    pressRef.current = setTimeout(() => {
      longPressedRef.current = true;
      navigator.vibrate?.(10);
      ctx.toggleCheck(id, false);
    }, LONG_PRESS_MS);
  };
  const endPress = () => clearTimeout(pressRef.current);

  return (
    <div
      role="row"
      data-id={id}
      aria-selected={selecting ? checked : selected}
      className={`relative border-b border-line [content-visibility:auto] [contain-intrinsic-size:auto_63px] ${
        selected || checked ? 'bg-wash' : ''
      }`}
    >
      <div className="flex h-[63px] items-center">
        <div role="gridcell" className="flex h-11 w-11 shrink-0 items-center justify-center">
          {selecting ? (
            // the whole 44 px cell is the target, not just the 20 px box
            <label className="flex h-11 w-11 cursor-pointer items-center justify-center">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => ctx.toggleCheck(id, false)}
                aria-label={`Select ${sample.name}`}
                className="m-0 h-5 w-5"
              />
            </label>
          ) : (
            <TextButton
              label=""
              onClick={() => ctx.togglePlay(sample)}
              aria-label={playing ? `Stop ${sample.name}` : `Play ${sample.name}`}
              aria-pressed={playing}
              current={playing}
              className="h-11 w-11 justify-center text-h4"
            >
              <PlayGlyph playing={playing} loading={loading} />
            </TextButton>
          )}
        </div>
        <button
          type="button"
          role="gridcell"
          className="flex h-[63px] min-w-0 flex-1 flex-col justify-center border-0 bg-transparent p-0 pl-1 text-left text-ink [-webkit-touch-callout:none] [-webkit-user-select:none]"
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerCancel={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => e.preventDefault()}
          onClick={() => {
            if (longPressedRef.current) return;
            if (selecting) ctx.toggleCheck(id, false);
            else ctx.cardTap(sample);
          }}
          aria-label={`${sample.name}. ${meta}`}
        >
          <span className="flex min-w-0 items-baseline gap-2">
            <span className={`min-w-0 truncate ${selected ? 'weight-up' : ''}`}>{sample.name}</span>
            <StatusNote sample={sample} busy={busy} onAnalyze={() => ctx.analyze(id)} />
          </span>
          <span className="truncate text-caption text-muted">{meta}</span>
        </button>
        <TextButton
          label=""
          aria-label={`Actions for ${sample.name}`}
          aria-haspopup="dialog"
          onClick={() => ctx.openActions(sample)}
          className="h-11 w-11 shrink-0 justify-center text-h4"
        >
          <FiMoreHorizontal className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
      </div>
      {error && <RowError error={error} onDismiss={() => ctx.dismissError(id)} className="pb-2 pl-12 pr-2" />}
      {playing && (
        <div className="absolute inset-x-0 bottom-0">
          <PreviewProgress audioRef={audioRef} duration={sample.duration_sec} />
        </div>
      )}
    </div>
  );
});
