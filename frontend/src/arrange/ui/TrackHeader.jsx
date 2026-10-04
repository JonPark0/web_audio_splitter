import React, { memo, useRef, useState } from 'react';
import { FiMoreHorizontal } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import InlineName from './InlineName';
import { MeterBar } from './Meters';
import { Menu } from './Overlay';
import { MIN_DB, dbToGain, formatDb, gainToDb } from './snap';

function formatPan(pan) {
  const v = Math.round(pan * 100);
  if (v === 0) return 'C';
  return v < 0 ? `L${-v}` : `R${v}`;
}

/** Mute / solo toggles; `big` = 44 px touch targets. */
function MuteSolo({ track, set, big, className = '' }) {
  // `!`: the global coarse-pointer rule makes every .link 44×44, and two of
  // those plus the name don't fit the phone's 72 px column / 56 px lane.
  const cls = big
    ? 'h-[38px] !min-h-[38px] !min-w-[34px] items-center justify-center sm:h-auto sm:!min-h-[44px] sm:!min-w-[44px]'
    : 'min-w-[16px] [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[32px]';
  return (
    <div className={`flex shrink-0 items-center ${big ? 'gap-0' : 'gap-2'} text-caption ${className}`}>
      <TextButton
        muted
        current={track.muted}
        aria-pressed={track.muted}
        onClick={() => set({ muted: !track.muted })}
        title="Mute"
        aria-label={`Mute ${track.name}`}
        label="M"
        className={`${cls} ${track.muted ? 'underline underline-offset-2' : ''}`}
      >
        M
      </TextButton>
      <TextButton
        muted
        current={track.soloed}
        aria-pressed={track.soloed}
        onClick={() => set({ soloed: !track.soloed })}
        title="Solo"
        aria-label={`Solo ${track.name}`}
        label="S"
        className={`${cls} ${track.soloed ? 'underline underline-offset-2' : ''}`}
      >
        S
      </TextButton>
    </div>
  );
}

/** Volume as a dB fader (equal travel = equal loudness step). */
export function VolumeSlider({ track, set, showValue = true, className = '' }) {
  return (
    <label className={`flex min-w-0 items-center gap-1.5 text-caption text-muted ${className}`} title="Volume (double-click resets)">
      <input
        type="range"
        min={MIN_DB}
        max="6"
        step="0.5"
        value={gainToDb(track.volume)}
        onChange={(e) => set({ volume: Math.min(2, Math.round(dbToGain(parseFloat(e.target.value)) * 10000) / 10000) }, `volume:${track.id}`)}
        onDoubleClick={() => set({ volume: 1 })}
        className="slider min-w-0 flex-1 [@media(pointer:coarse)]:h-11"
        aria-label={`${track.name} volume`}
        aria-valuetext={formatDb(track.volume)}
      />
      {showValue && <span className="w-[52px] shrink-0 text-right tabular-nums text-ink">{formatDb(track.volume)}</span>}
    </label>
  );
}

export function PanSlider({ track, set, className = '' }) {
  return (
    <label className={`flex min-w-0 items-center gap-1.5 text-caption text-muted ${className}`} title="Pan (double-click centres)">
      <input
        type="range"
        min="-1"
        max="1"
        step="0.01"
        value={track.pan}
        onChange={(e) => set({ pan: parseFloat(e.target.value) }, `pan:${track.id}`)}
        onDoubleClick={() => set({ pan: 0 })}
        className="slider min-w-0 flex-1 [@media(pointer:coarse)]:h-11"
        aria-label={`${track.name} pan`}
      />
      <span className="w-7 shrink-0 text-right tabular-nums text-ink">{formatPan(track.pan)}</span>
    </label>
  );
}

/**
 * Track header row (left column), same height as its lane.
 *   desktop: name, M/S, menu; volume (dB) + pan as the lane height allows;
 *            drag the grip to reorder.
 *   tablet:  name over 44 px M/S; the name opens the track sheet.
 *   phone:   name over M/S in 72 px; the name opens the track sheet.
 * A peak meter runs down the right edge.
 */
export default memo(function TrackHeader({
  track,
  index,
  count,
  height,
  mode,
  audible,
  selected,
  meterClock,
  onSelect,
  onUpdate,
  onDelete,
  onMove,
  onOpen,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [dragDy, setDragDy] = useState(null);
  const menuBtn = useRef(null);
  const clipCount = track.clips.length;
  // `coalesce` groups a slider scrub into one undo step.
  const set = (patch, coalesce) => onUpdate(track.id, patch, coalesce);
  const meterPick = (m) => m.tracks?.[track.id] ?? 0;

  const requestDelete = () => {
    if (clipCount === 0) onDelete(track.id);
    else setAsking(true);
  };

  // Reorder by dragging the grip (mouse/pen); touch uses the menu / sheet.
  const onGripDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const y0 = e.clientY;
    const move = (ev) => setDragDy(ev.clientY - y0);
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDragDy(null);
      const to = Math.max(0, Math.min(count - 1, index + Math.round((ev.clientY - y0) / height)));
      if (to !== index) onMove(track.id, to);
    };
    const cancel = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      setDragDy(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  const meter = (
    <MeterBar
      clock={meterClock}
      pick={meterPick}
      vertical
      label={`${track.name} level`}
      className="absolute bottom-1 right-0.5 top-1 w-[3px]"
    />
  );

  const rowBase = `relative border-b border-line ${selected ? 'bg-wash' : 'bg-paper'} ${dragDy !== null ? 'z-30 outline outline-1 outline-ink' : ''}`;
  const rowStyle = { height, transform: dragDy !== null ? `translateY(${dragDy}px)` : undefined };

  if (mode !== 'desktop') {
    const phone = mode === 'phone';
    return (
      <div onPointerDown={() => onSelect(track.id)} className={`${rowBase} flex flex-col`} style={rowStyle}>
        <button
          type="button"
          onClick={() => onOpen?.(track.id)}
          title="Track settings"
          className={`weight-hover block w-full truncate border-0 bg-transparent px-1.5 pt-0.5 text-left text-caption leading-tight ${
            audible ? 'text-ink' : 'text-muted'
          }`}
        >
          {track.name}
        </button>
        <MuteSolo track={track} set={set} big className={`mt-auto ${phone ? 'justify-start pl-0.5' : 'justify-start pl-1'}`} />
        {meter}
      </div>
    );
  }

  return (
    <div onPointerDown={() => onSelect(track.id)} className={`${rowBase} flex`} style={rowStyle}>
      <div
        onPointerDown={onGripDown}
        title="Drag to reorder"
        aria-hidden="true"
        className="flex w-3 shrink-0 cursor-grab select-none items-center justify-center text-caption leading-none text-muted hover:text-ink active:cursor-grabbing"
      >
        ⋮
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5 pr-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <InlineName
            value={track.name}
            label="Track name"
            onCommit={(name) => set({ name })}
            className={`flex-1 text-caption ${audible ? '' : '!text-muted'}`}
            inputClassName="min-w-0 flex-1 text-caption"
          />
          <MuteSolo track={track} set={set} />
          <span className="relative" ref={menuBtn}>
            <TextButton
              muted
              label=""
              onClick={() => setMenuOpen((o) => !o)}
              aria-label={`${track.name} options`}
              aria-expanded={menuOpen}
              title="Track options"
            >
              <FiMoreHorizontal className="icon" strokeWidth={1.5} aria-hidden="true" />
            </TextButton>
            <Menu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              anchorRef={menuBtn}
              align="left"
              items={[
                { label: 'Move up', disabled: index === 0, onSelect: () => onMove(track.id, index - 1) },
                { label: 'Move down', disabled: index >= count - 1, onSelect: () => onMove(track.id, index + 1) },
                { separator: true },
                { label: clipCount ? `Delete (${clipCount} ${clipCount === 1 ? 'clip' : 'clips'})…` : 'Delete', onSelect: requestDelete },
              ]}
            />
          </span>
        </div>
        {asking ? (
          <div className="flex items-baseline gap-3 text-caption" onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}>
            <span className="truncate">Delete track?</span>
            <TextButton autoFocus onClick={() => onDelete(track.id)}>
              Confirm
            </TextButton>
            <TextButton muted onClick={() => setAsking(false)}>
              Cancel
            </TextButton>
          </div>
        ) : height >= 88 ? (
          <>
            <VolumeSlider track={track} set={set} />
            <PanSlider track={track} set={set} />
          </>
        ) : height >= 56 ? (
          <div className="flex min-w-0 items-center gap-2">
            <VolumeSlider track={track} set={set} className="flex-[3]" />
            <PanSlider track={track} set={set} className="flex-[2]" />
          </div>
        ) : null}
      </div>
      {meter}
    </div>
  );
});
