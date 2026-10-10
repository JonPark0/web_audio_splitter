import React from 'react';
import { FiMinus, FiMoreHorizontal, FiPause, FiPlay, FiPlus } from 'react-icons/fi';
import ABToggle from '../ABToggle';
import TextButton from '../TextButton';
import WordToggle from '../WordToggle';
import TimeReadout from './TimeReadout';

export const SNAP_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'zero', label: 'Zero crossing' },
  { value: 'transient', label: 'Transient' },
  { value: 'beat', label: 'Beat length' },
];

const SNAP_HINT = {
  off: 'Selections follow the pointer exactly',
  zero: 'Sample edges move to the nearest zero crossing when saved (no clicks)',
  transient: 'Selection edges snap to the nearest hit while dragging',
  beat: 'The selection length snaps to whole beats at the song tempo (start stays)',
};

function PlayButton({ playing, pending, onToggle, big = false }) {
  const on = playing || pending;
  const Icon = on ? FiPause : FiPlay;
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`link shrink-0 ${big ? 'h-11 w-11 justify-center' : 'rs-hit min-w-[4.5rem] items-start'}`}
      aria-label={on ? 'Pause (Space)' : 'Play (Space)'}
      title={on ? 'Pause (Space)' : 'Play (Space)'}
    >
      <span className="inline-flex items-center gap-2">
        <Icon className={`icon ${big ? 'text-h3' : ''}`} aria-hidden="true" />
        {!big && <span className="text-p">{on ? 'Pause' : 'Play'}</span>}
      </span>
    </button>
  );
}

function IconButton({ onClick, label, children, disabled, big }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`link rs-hit items-center justify-center ${big ? 'h-11 w-11' : 'coarse:h-11 coarse:min-w-11'}`}
    >
      {children}
    </button>
  );
}

/** Snap / All O|R / waveform scale / ruler — inline on desktop, in a menu elsewhere. */
export function TransportOptions({ snap, onSnap, bpm, allVariant, onAllVariant, anyRecovered, scaleMode, onScaleMode, rulerMode, onRulerMode, stacked = false }) {
  const row = stacked ? 'flex flex-col gap-1 py-2' : 'flex items-center gap-2';
  return (
    <>
      <label className={row} title={SNAP_HINT[snap]}>
        <span className="text-muted">Snap</span>
        <select value={snap} onChange={(e) => onSnap(e.target.value)} className={`ainput rs-input w-auto pb-0 ${stacked ? '' : 'text-caption'}`}>
          {SNAP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} disabled={o.value === 'beat' && !bpm}>
              {o.label}
              {o.value === 'beat' && !bpm ? ' (no tempo)' : ''}
            </option>
          ))}
        </select>
      </label>
      {anyRecovered && (
        <div className={row}>
          <span className="text-muted">All</span>
          <ABToggle variant={allVariant} onChange={onAllVariant} className="gap-3" />
        </div>
      )}
      <div className={row} title="Shared: one amplitude scale, so quiet stems look quiet. Each: every stem normalised to its own peak.">
        <span className="text-muted">Scale</span>
        <WordToggle
          name="rs-scale"
          centerOnMobile={false}
          className="gap-x-3"
          value={scaleMode}
          onChange={onScaleMode}
          options={[
            { value: 'shared', label: 'Shared' },
            { value: 'each', label: 'Each' },
          ]}
        />
      </div>
      {bpm > 0 && stacked && (
        <div className={row}>
          <span className="text-muted">Ruler</span>
          <WordToggle
            name="rs-ruler-sheet"
            centerOnMobile={false}
            className="gap-x-3"
            value={rulerMode}
            onChange={onRulerMode}
            options={[
              { value: 'bars', label: 'Bars' },
              { value: 'time', label: 'Time' },
            ]}
          />
        </div>
      )}
    </>
  );
}

/**
 * Sticky transport (desktop/tablet): Play, time, Loop, zoom − + Fit / to
 * selection, and (desktop) snap, all-variant and scale inline; tablet moves
 * those behind "More".
 */
export default function Transport({
  timeline,
  duration,
  playing,
  pending,
  onToggle,
  loopOn,
  onLoop,
  hasSelection,
  onZoomIn,
  onZoomOut,
  onFit,
  onZoomSel,
  zoomed,
  wide,
  coarse,
  onMore,
  options,
}) {
  return (
    <div className="flex h-11 min-w-0 items-center gap-x-5 text-caption max-xl:gap-x-4 max-md:gap-x-3">
      <PlayButton playing={playing} pending={pending} onToggle={onToggle} />
      <TimeReadout timeline={timeline} duration={duration} className="text-p" />
      <TextButton
        muted
        current={loopOn}
        aria-pressed={loopOn}
        onClick={onLoop}
        className="rs-hit"
        title={hasSelection ? 'Loop the selection (L)' : 'Loop the whole song (L) — select a region to loop just that'}
      >
        Loop
      </TextButton>
      <span className="h-4 w-px shrink-0 bg-line" aria-hidden="true" />
      <div className="flex items-center gap-3">
        <IconButton onClick={onZoomOut} label="Zoom out (−)" disabled={!zoomed}>
          <FiMinus className="icon" aria-hidden="true" />
        </IconButton>
        <IconButton onClick={onZoomIn} label="Zoom in (+)">
          <FiPlus className="icon" aria-hidden="true" />
        </IconButton>
        <TextButton muted onClick={onFit} disabled={!zoomed} className="rs-hit" title="Show the whole song">
          Fit
        </TextButton>
        <TextButton muted onClick={onZoomSel} disabled={!hasSelection} className="rs-hit" title="Zoom to the selection (Z)">
          Selection
        </TextButton>
      </div>
      {wide ? (
        <>
          <span className="h-4 w-px shrink-0 bg-line" aria-hidden="true" />
          <TransportOptions {...options} />
          {!coarse && (
            <span className="ml-auto hidden truncate text-muted 2xl:inline">Drag to select · Ctrl/⌘ + wheel to zoom · Space to play</span>
          )}
        </>
      ) : (
        <TextButton muted onClick={onMore} className="rs-hit ml-auto" title="Snap, variants, waveform scale">
          More
        </TextButton>
      )}
    </div>
  );
}

/** Phone: the one bottom bar — Play, time, − + Fit, ⋯ (everything else). */
export function PhoneBar({ timeline, duration, playing, pending, onToggle, onZoomIn, onZoomOut, onFit, zoomed, onMore }) {
  return (
    <div className="rs-bottom-bar pl-safe-inset pr-safe-inset fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper">
      <div className="flex h-14 items-center px-2">
        <PlayButton big playing={playing} pending={pending} onToggle={onToggle} />
        <TimeReadout timeline={timeline} duration={duration} short className="min-w-0 flex-1 truncate px-1 text-caption" />
        <IconButton big onClick={onZoomOut} label="Zoom out" disabled={!zoomed}>
          <FiMinus className="icon" aria-hidden="true" />
        </IconButton>
        <IconButton big onClick={onZoomIn} label="Zoom in">
          <FiPlus className="icon" aria-hidden="true" />
        </IconButton>
        <TextButton muted onClick={onFit} disabled={!zoomed} className="h-11 min-w-11 justify-center text-caption">
          Fit
        </TextButton>
        <IconButton big onClick={onMore} label="Loop, snap, variants, downloads">
          <FiMoreHorizontal className="icon" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
