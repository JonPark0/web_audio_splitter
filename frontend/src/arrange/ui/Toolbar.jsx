import React, { useEffect, useRef, useState } from 'react';
import { FiChevronDown, FiMinus, FiMoreHorizontal, FiPlay, FiPlus, FiSquare } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { MAX_BPM, MIN_BPM } from '../project';
import { ClipIndicator, MeterBar } from './Meters';
import { Menu, useDismiss } from './Overlay';
import { useClockListener } from './playheadClock';
import { MAX_ZOOM, MIN_DB, MIN_ZOOM, SNAP_OPTIONS, dbToGain, formatDb, formatPosition, gainToDb } from './snap';

const tap = 'coarse:min-h-[44px] coarse:min-w-[44px] items-center justify-center';
const icon = (C) => <C className="icon" strokeWidth={1.5} aria-hidden="true" />;

/** bars.beats.16ths readout, written straight to the DOM from the clock. */
export function PositionReadout({ clock, beatsPerBar, className = '' }) {
  const ref = useRef(null);
  useClockListener(
    clock,
    (beat) => {
      const text = formatPosition(beat, beatsPerBar);
      if (ref.current && ref.current.textContent !== text) ref.current.textContent = text;
    },
    [beatsPerBar]
  );
  return (
    <span ref={ref} aria-label="Position (bar.beat.sixteenth)" className={`inline-block tabular-nums leading-none ${className}`}>
      1.1.1
    </span>
  );
}

const roundBpm = (v) => Math.round(v * 100) / 100;

/** Project tempo: typed, committed on Enter/blur, reverted on Escape or bad input. */
export function BpmInput({ bpm, onCommit, className = '', showLabel = true }) {
  const [draft, setDraft] = useState(String(bpm));
  const focused = useRef(false);
  const cancel = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(String(bpm));
  }, [bpm]);
  const commit = () => {
    if (!focused.current) return;
    focused.current = false;
    const value = Number(draft);
    if (cancel.current || draft.trim() === '' || !Number.isFinite(value)) {
      cancel.current = false;
      setDraft(String(bpm));
      return;
    }
    const next = roundBpm(Math.min(MAX_BPM, Math.max(MIN_BPM, value)));
    setDraft(String(next));
    if (next !== bpm) onCommit(next);
  };
  return (
    <label className={`flex items-baseline gap-1 ${className}`}>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        onFocus={(e) => {
          focused.current = true;
          e.target.select();
        }}
        onChange={(e) => {
          focused.current = true;
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') {
            cancel.current = e.key === 'Escape';
            commit();
            e.currentTarget.blur();
          }
        }}
        aria-label="Project BPM"
        className="ainput w-[3.25rem] !pb-0.5 tabular-nums coarse:min-h-[44px] coarse:text-p"
      />
      {showLabel && <span className="text-caption text-muted">BPM</span>}
    </label>
  );
}

export function PlayButton({ playing, onToggle, big = false }) {
  return (
    <TextButton
      onClick={onToggle}
      label=""
      aria-label={playing ? 'Stop (Space)' : 'Play (Space)'}
      aria-pressed={playing}
      title={playing ? 'Stop (Space)' : 'Play (Space)'}
      current={playing}
      className={`${big ? 'h-11 w-11 text-h3' : 'min-h-[28px] min-w-[28px] text-h3'} items-center justify-center ${tap}`}
    >
      {playing ? icon(FiSquare) : icon(FiPlay)}
    </TextButton>
  );
}

const SAVE_LABELS = { pending: 'Unsaved', saving: 'Saving…', saved: 'Saved', error: 'Not saved', conflict: 'Conflict' };

export function SaveIndicator({ status, error, retryAt, onRetry, compact }) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!retryAt) return undefined;
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [retryAt]);
  const secs = retryAt ? Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)) : null;
  const bad = status === 'error' || status === 'conflict';
  return (
    <span role="status" aria-live="polite" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap text-caption">
      <span title={bad ? error || undefined : undefined} className={bad ? 'text-ink' : 'text-muted'}>
        {SAVE_LABELS[status] || ''}
        {status === 'error' && secs !== null && !compact ? ` · retry in ${secs} s` : ''}
      </span>
      {status === 'error' && (
        <TextButton onClick={onRetry} className={`text-caption ${tap}`}>
          Retry
        </TextButton>
      )}
    </span>
  );
}

/** Current project name as a menu: other projects, new, rename, delete. */
export function ProjectPicker({ projects, project, busy, onOpen, onCreate, onRename, onDelete, onShowList, className = '' }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // 'rename' | 'delete'
  const [draft, setDraft] = useState('');
  const anchor = useRef(null);
  if (mode === 'rename') {
    const finish = (commit) => {
      setMode(null);
      const name = draft.trim();
      if (commit && name && name !== project.name) onRename(name);
    };
    return (
      <input
        autoFocus
        value={draft}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
        className={`ainput !pb-0.5 coarse:min-h-[44px] coarse:text-p ${className}`}
      />
    );
  }
  if (mode === 'delete') {
    return (
      <span className="flex min-w-0 items-baseline gap-3 whitespace-nowrap" onKeyDown={(e) => e.key === 'Escape' && setMode(null)}>
        <span className="truncate">Delete “{project.name}”?</span>
        <TextButton
          autoFocus
          disabled={busy}
          onClick={() => {
            setMode(null);
            onDelete();
          }}
          className={tap}
        >
          Confirm
        </TextButton>
        <TextButton muted onClick={() => setMode(null)} className={tap}>
          Cancel
        </TextButton>
      </span>
    );
  }
  const items = [
    ...projects.map((p) => ({
      key: p.id,
      label: p.name,
      checked: p.id === project?.id,
      hint: `${p.track_count ?? 0}T · ${p.clip_count ?? 0}C · ${Math.round(p.bpm)}`,
      onSelect: () => p.id !== project?.id && onOpen(p.id),
    })),
    { separator: true },
    { label: 'New project', disabled: busy, onSelect: onCreate },
    project && {
      label: 'Rename…',
      onSelect: () => {
        setDraft(project.name);
        setMode('rename');
      },
    },
    project && { label: 'Delete…', disabled: busy, onSelect: () => setMode('delete') },
  ];
  return (
    <span ref={anchor} className={`relative flex min-w-0 ${className}`}>
      <button
        type="button"
        onClick={() => {
          if (!open) onShowList?.();
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Projects"
        className="weight-hover flex min-h-[28px] min-w-0 items-center gap-1 border-0 bg-transparent p-0 text-left text-ink coarse:min-h-[44px]"
      >
        <span className="truncate">{project ? project.name : 'No project'}</span>
        <FiChevronDown className="icon shrink-0" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <Menu open={open} onClose={() => setOpen(false)} items={items} anchorRef={anchor} align="left" title="Projects" />
    </span>
  );
}

/** Export popover: range, stems, normalise. */
export function ExportControl({ project, exporting, progress, disabled, onExport, placement = 'down', align = 'right' }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState('song');
  const [stems, setStems] = useState(false);
  const [normalize, setNormalize] = useState(false);
  const ref = useRef(null);
  useDismiss(open, ref, () => setOpen(false));
  const hasLoop = project?.loop?.end_beat > project?.loop?.start_beat;
  const effective = hasLoop ? scope : 'song';
  const word = (on, label, onClick, title) => (
    <TextButton current={on} aria-pressed={on} onClick={onClick} title={title} className={tap}>
      {label}
    </TextButton>
  );
  return (
    <span ref={ref} className="relative">
      <TextButton
        muted
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
        aria-busy={exporting}
        label="Export"
        className={tap}
      >
        {exporting ? `Rendering${progress ? ` ${progress.done}/${progress.total}` : '…'}` : 'Export'}
      </TextButton>
      {open && (
        <div
          role="dialog"
          aria-label="Export"
          className={`absolute z-50 flex w-[min(300px,92vw)] flex-col gap-2 border border-line bg-paper p-3 ${
            align === 'right' ? 'right-0' : 'left-0'
          } ${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'}`}
        >
          <div className="flex items-baseline gap-4">
            <span className="w-16 text-caption text-muted">Range</span>
            {word(effective === 'song', 'Song', () => setScope('song'))}
            {word(effective === 'loop', 'Loop', () => hasLoop && setScope('loop'), hasLoop ? 'The loop region' : 'No loop region')}
          </div>
          <div className="flex items-baseline gap-4">
            <span className="w-16 text-caption text-muted">Files</span>
            {word(!stems, 'Mix', () => setStems(false), 'One stereo WAV')}
            {word(stems, 'Stems', () => setStems(true), 'One WAV per track, zipped')}
          </div>
          <div className="flex items-baseline gap-4">
            <span className="w-16 text-caption text-muted">Level</span>
            {word(!normalize, 'As mixed', () => setNormalize(false))}
            {word(normalize, 'Normalise', () => setNormalize(true), 'Peak at −1 dBFS (stems share one gain)')}
          </div>
          <p className="m-0 text-caption text-muted">24-bit / 48 kHz WAV{stems ? ' per track, in one ZIP' : ''}.</p>
          <TextButton
            disabled={exporting || disabled}
            onClick={() => {
              setOpen(false);
              onExport({ scope: effective, stems, normalize });
            }}
            className={`self-start ${tap}`}
          >
            {stems ? 'Export stems' : 'Export WAV'}
          </TextButton>
        </div>
      )}
    </span>
  );
}

/** Master: stereo peak meter, clip light, and (when wide) the master fader. */
export function MasterSection({ meterClock, masterGain, onMasterGain, showFader }) {
  const pick = (m) => m.master;
  return (
    <span className="flex shrink-0 items-center gap-2" title="Master level">
      <MeterBar clock={meterClock} pick={pick} channels={2} label="Master level" className="h-2.5 w-14" />
      <ClipIndicator clock={meterClock} pick={pick} className="w-8 text-left" />
      {showFader && (
        <label className="flex items-center gap-1.5 text-caption">
          <input
            type="range"
            min={MIN_DB}
            max="6"
            step="0.5"
            value={gainToDb(masterGain)}
            onChange={(e) => onMasterGain(Math.round(dbToGain(parseFloat(e.target.value)) * 10000) / 10000)}
            onDoubleClick={() => onMasterGain(1)}
            aria-label="Master volume"
            aria-valuetext={formatDb(masterGain)}
            className="slider w-16 coarse:h-11"
          />
          <span className="w-[52px] text-right tabular-nums">{formatDb(masterGain)}</span>
        </label>
      )}
    </span>
  );
}

export function MoreButton({ open, onToggle, anchorRef, label = 'More', className = '' }) {
  return (
    <span ref={anchorRef} className={`relative ${className}`}>
      <TextButton muted label="" onClick={onToggle} aria-label={label} aria-expanded={open} title={label} className={`min-h-[28px] min-w-[28px] ${tap}`}>
        {icon(FiMoreHorizontal)}
      </TextButton>
    </span>
  );
}

export function ZoomButtons({ zoom, onZoom, onFit }) {
  return (
    <span className="flex items-center gap-2">
      <TextButton muted label="" onClick={() => onZoom(-1)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out (−)" title="Zoom out (−, Ctrl/Cmd+wheel)" className={`min-w-[20px] ${tap}`}>
        {icon(FiMinus)}
      </TextButton>
      <TextButton muted label="" onClick={() => onZoom(1)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in (+)" title="Zoom in (+)" className={`min-w-[20px] ${tap}`}>
        {icon(FiPlus)}
      </TextButton>
      <TextButton muted onClick={onFit} title="Zoom to fit the song" className={tap}>
        Fit
      </TextButton>
    </span>
  );
}

export function SnapSelect({ snap, onSnapChange }) {
  return (
    <label className="flex items-baseline gap-1.5">
      <span className="text-caption text-muted">Snap</span>
      <select value={snap} onChange={(e) => onSnapChange(e.target.value)} className="ainput w-[4.5rem] !pb-0.5 text-caption coarse:min-h-[44px] coarse:text-p" aria-label="Snap">
        {SNAP_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
