import React, { memo } from 'react';
import { FiMoreHorizontal, FiPlay, FiSquare } from 'react-icons/fi';
import TextButton from '../TextButton';
import DeleteControl from './DeleteControl';
import NameEditor from './NameEditor';
import RowError from './RowError';
import Waveform from './Waveform';
import { formatBpm, formatKey, formatLength } from './format';
import { COARSE } from './ui';

// Column tracks, shared with the header so they line up.
export const GRID = {
  desktop: 'grid-cols-[28px_32px_120px_minmax(0,1fr)_60px_60px_96px_minmax(0,11rem)_32px]',
  tablet: 'grid-cols-[44px_44px_88px_minmax(0,1fr)_52px_88px_44px]',
};

export function PlayGlyph({ playing, loading }) {
  const Icon = playing ? FiSquare : FiPlay;
  return <Icon className={`icon ${loading ? 'animate-pulse' : ''}`} strokeWidth={1.5} aria-hidden="true" />;
}

export function StatusNote({ sample, busy, onAnalyze }) {
  if (sample.analysis_status === 'pending') {
    return (
      <span className="shrink-0 text-caption text-muted" role="status">
        Analyzing…
      </span>
    );
  }
  if (sample.analysis_status === 'failed') {
    return (
      <span className="inline-flex shrink-0 items-baseline gap-2 text-caption">
        <span className="text-muted">analysis failed</span>
        <TextButton disabled={busy} onClick={(e) => (e.stopPropagation(), onAnalyze())} className={COARSE}>
          Re-analyze
        </TextButton>
      </span>
    );
  }
  return null;
}

/**
 * One dense table row (desktop 36 px, tablet 48 px). Editing lives in the
 * inspector; the row only selects, plays, seeks, checks and opens its ⋯
 * menu - so it's ~20 nodes, memoized, and skipped by layout/paint while
 * off-screen (content-visibility).
 */
export default memo(function SampleRow({
  sample,
  size,
  selected,
  checked,
  playing,
  loading,
  renaming,
  confirming,
  error,
  busy,
  camelot,
  audioRef,
  ctx,
}) {
  const tablet = size === 'tablet';
  const id = sample.id;
  const meta = [formatLength(sample.duration_sec), (sample.tags || []).join(', ')].filter(Boolean).join(' · ');

  return (
    <div
      role="row"
      data-id={id}
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      onClick={(e) => {
        // clicks on the row's own controls (Confirm, Re-analyze, links...) aren't row clicks
        if (e.target !== e.currentTarget && e.target.closest('button, a, input, select, textarea, label')) return;
        ctx.rowClick(sample, e);
      }}
      onDoubleClick={() => ctx.rowDoubleClick(sample)}
      onFocus={(e) => e.target === e.currentTarget && ctx.rowFocus(sample)}
      className={`grid ${GRID[size]} cursor-default items-center border-b border-line outline-offset-[-2px] [content-visibility:auto] ${
        tablet ? 'min-h-12 [contain-intrinsic-size:auto_47px]' : 'min-h-9 [contain-intrinsic-size:auto_35px]'
      } ${selected ? 'bg-wash' : 'hover:bg-wash/60'}`}
    >
      <label role="gridcell" className="flex h-full cursor-pointer items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => {}}
          onClick={(e) => ctx.toggleCheck(id, e.shiftKey)}
          aria-label={`Select ${sample.name}`}
          className={`m-0 cursor-pointer ${tablet ? 'h-5 w-5' : 'h-3.5 w-3.5'}`}
        />
      </label>
      <div role="gridcell" className="flex justify-center">
        <TextButton
          label=""
          onClick={(e) => {
            e.stopPropagation();
            ctx.togglePlay(sample);
          }}
          aria-label={playing ? `Stop ${sample.name}` : `Play ${sample.name}`}
          aria-pressed={playing}
          title={playing ? 'Stop (Space)' : 'Play (Space)'}
          current={playing}
          className={`text-h4 ${tablet ? 'h-11 w-11 justify-center' : `h-8 w-8 justify-center ${COARSE}`}`}
        >
          <PlayGlyph playing={playing} loading={loading} />
        </TextButton>
      </div>
      <div role="gridcell" className="pr-3">
        <Waveform
          sampleId={id}
          playing={playing}
          audioRef={audioRef}
          onSeek={(r) => ctx.seek(sample, r)}
          className={tablet ? 'h-8' : 'h-6'}
          label="Click to play from here"
        />
      </div>
      <div role="gridcell" className="flex min-w-0 flex-col justify-center pr-3">
        <div className="flex min-w-0 items-baseline gap-3">
          {renaming ? (
            <NameEditor sample={sample} busy={busy} onPatch={(c) => ctx.patch(id, c)} editing onEditingChange={(v) => !v && ctx.setRenaming(null)} size="text-p" />
          ) : (
            <span className={`min-w-0 truncate ${selected ? 'weight-up' : ''}`} title={sample.name}>
              {sample.name}
            </span>
          )}
          <StatusNote sample={sample} busy={busy} onAnalyze={() => ctx.analyze(id)} />
        </div>
        {tablet && <span className="truncate text-caption text-muted">{meta}</span>}
      </div>
      {confirming ? (
        <div role="gridcell" className={`flex items-center justify-end gap-3 pr-1 ${tablet ? 'col-[5/-1]' : 'col-[5/-1]'}`}>
          <span className="min-w-0 truncate text-caption text-muted">{sample.name}</span>
          <DeleteControl
            busy={busy}
            confirming
            onConfirmingChange={(v) => !v && ctx.setConfirming(null)}
            onDelete={() => ctx.remove(id)}
          />
        </div>
      ) : (
        <>
          {!tablet && (
            <div role="gridcell" className="pr-3 text-right tabular-nums">
              {formatLength(sample.duration_sec)}
            </div>
          )}
          <div
            role="gridcell"
            className="pr-3 text-right tabular-nums"
            title={sample.bpm_overridden ? `Set by you (detected ${formatBpm(sample.bpm_detected)})` : undefined}
          >
            {formatBpm(sample.bpm)}
          </div>
          <div role="gridcell" className="truncate pr-3" title={sample.key || undefined}>
            {formatKey(sample.key, { camelot })}
          </div>
          {!tablet && (
            <div role="gridcell" className="truncate pr-3 text-caption" title={(sample.tags || []).join(', ')}>
              {(sample.tags || []).join(', ')}
            </div>
          )}
          <div role="gridcell" className="flex justify-center">
            <TextButton
              label=""
              aria-label={`More for ${sample.name}`}
              aria-haspopup="menu"
              title="More"
              onClick={(e) => {
                e.stopPropagation();
                ctx.openMenu(sample, e.currentTarget.getBoundingClientRect());
              }}
              className={tablet ? 'h-11 w-11 justify-center' : `h-8 w-8 justify-center ${COARSE}`}
            >
              <FiMoreHorizontal className="icon" strokeWidth={1.5} aria-hidden="true" />
            </TextButton>
          </div>
        </>
      )}
      {error && (
        <div role="gridcell" className="col-span-full pb-1.5 pl-[60px]">
          <RowError error={error} onDismiss={() => ctx.dismissError(id)} />
        </div>
      )}
    </div>
  );
});
