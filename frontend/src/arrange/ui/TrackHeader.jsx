import React, { memo, useRef, useState } from 'react';
import { FiMoreHorizontal } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { ResetValue } from './fields';
import InlineName from './InlineName';
import { useCoarsePointer } from './layout';
import { MeterBar } from './Meters';
import { Menu } from './Overlay';
import { MIN_DB, dbToGain, formatDb, gainToDb } from './snap';

function formatPan(pan) {
  const v = Math.round(pan * 100);
  if (v === 0) return 'C';
  return v < 0 ? `L${-v}` : `R${v}`;
}

// Per layout, not per viewport width: a landscape phone is 'phone' at 844 px.
//   phone   44 px: side by side under the name, clear of the meter, in the
//           96 px column / 64 px lane (snap.js)
//   tablet  44 px on touch, compact with a mouse
//   desktop inline with the name
const MS_SIZE = {
  phone: 'h-11 w-11 items-center justify-center',
  tablet: 'min-h-[24px] min-w-[28px] items-center justify-center',
  desktop: 'min-w-[16px] coarse:min-h-[44px] coarse:min-w-[32px]',
};

/** Mute / solo toggles. */
function MuteSolo({ track, set, size = 'desktop', className = '' }) {
  const cls = MS_SIZE[size];
  return (
    <div className={`flex shrink-0 items-center ${size === 'desktop' ? 'gap-2' : 'gap-0'} text-caption ${className}`}>
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

/**
 * Volume as a dB fader (equal travel = equal loudness step). The readout
 * resets to 0 dB when tapped (double-click on the slider still does).
 */
export function VolumeSlider({ track, set, showValue = true, className = '' }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-caption text-muted ${className}`} title="Volume (double-click or tap the value to reset)">
      <input
        type="range"
        min={MIN_DB}
        max="6"
        step="0.5"
        value={gainToDb(track.volume)}
        onChange={(e) => set({ volume: Math.min(2, Math.round(dbToGain(parseFloat(e.target.value)) * 10000) / 10000) }, `volume:${track.id}`)}
        onDoubleClick={() => set({ volume: 1 })}
        className="slider min-w-0 flex-1 coarse:h-11"
        aria-label={`${track.name} volume`}
        aria-valuetext={formatDb(track.volume)}
      />
      {showValue && (
        <ResetValue onReset={() => set({ volume: 1 })} label={`Reset ${track.name} volume to 0 dB`} className="w-[52px]">
          {formatDb(track.volume)}
        </ResetValue>
      )}
    </div>
  );
}

/** Pan; the readout centres it when tapped. */
export function PanSlider({ track, set, className = '' }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-caption text-muted ${className}`} title="Pan (double-click or tap the value to centre)">
      <input
        type="range"
        min="-1"
        max="1"
        step="0.01"
        value={track.pan}
        onChange={(e) => set({ pan: parseFloat(e.target.value) }, `pan:${track.id}`)}
        onDoubleClick={() => set({ pan: 0 })}
        className="slider min-w-0 flex-1 coarse:h-11"
        aria-label={`${track.name} pan`}
        aria-valuetext={formatPan(track.pan)}
      />
      <ResetValue onReset={() => set({ pan: 0 })} label={`Centre ${track.name} pan`} className="w-7 coarse:!min-w-[32px]">
        {formatPan(track.pan)}
      </ResetValue>
    </div>
  );
}

/**
 * Track header row (left column), same height as its lane.
 *   desktop: name, M/S, menu; volume (dB) + pan as the lane height allows;
 *            drag the grip to reorder.
 *            On touch a name renames only once its track is selected.
 *   tablet:  name over M/S (44 px on touch; side by side in a small lane
 *            with a mouse); the name opens the track sheet.
 *   phone:   name over 44 px M/S in 96 px; the name opens the track sheet.
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
  const nameRef = useRef(null);
  const coarse = useCoarsePointer();
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
    // A small lane with a mouse: name and M/S side by side (stacked they need
    // ~46 px; touch lanes are made tall enough to stack 44 px buttons).
    const inline = !phone && height < 56;
    return (
      <div onPointerDown={() => onSelect(track.id)} className={`${rowBase} flex ${inline ? 'items-center pr-2' : 'flex-col'}`} style={rowStyle}>
        <button
          type="button"
          onClick={() => onOpen?.(track.id)}
          title="Track settings"
          className={`weight-hover block min-w-0 truncate border-0 bg-transparent px-1.5 text-left text-caption leading-tight ${
            inline ? 'flex-1' : 'w-full pt-0.5'
          } ${audible ? 'text-ink' : 'text-muted'}`}
        >
          {track.name}
        </button>
        <MuteSolo track={track} set={set} size={mode} className={inline ? '' : `mt-auto justify-start ${phone ? '' : 'pl-1'}`} />
        {meter}
      </div>
    );
  }

  // Rows of controls the lane has room for: name/M/S/menu, then volume and
  // pan side by side, then pan on its own row. 44 px rows on touch
  // (ArrangeScreen makes touch lanes tall enough for two), ~26 px with a mouse.
  const rows = coarse ? (height >= 133 ? 3 : height >= 89 ? 2 : 1) : height >= 88 ? 3 : height >= 56 ? 2 : 1;

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
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5 pr-2.5 coarse:gap-0 coarse:py-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <InlineName
            ref={nameRef}
            value={track.name}
            label="Track name"
            armed={selected}
            onCommit={(name) => set({ name })}
            className={`flex-1 text-caption coarse:leading-[44px] ${audible ? '' : '!text-muted'}`}
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
                { label: 'Rename…', onSelect: () => nameRef.current?.edit() },
                { label: 'Move up', disabled: index === 0, onSelect: () => onMove(track.id, index - 1) },
                { label: 'Move down', disabled: index >= count - 1, onSelect: () => onMove(track.id, index + 1) },
                { separator: true },
                { label: clipCount ? `Delete (${clipCount} ${clipCount === 1 ? 'clip' : 'clips'})…` : 'Delete', onSelect: requestDelete },
              ]}
            />
          </span>
        </div>
        {asking ? (
          <div className="flex items-center gap-3 text-caption" onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}>
            <span className="truncate">Delete track?</span>
            <TextButton autoFocus onClick={() => onDelete(track.id)}>
              Confirm
            </TextButton>
            <TextButton muted onClick={() => setAsking(false)}>
              Cancel
            </TextButton>
          </div>
        ) : rows === 3 ? (
          <>
            <VolumeSlider track={track} set={set} />
            <PanSlider track={track} set={set} />
          </>
        ) : rows === 2 ? (
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
