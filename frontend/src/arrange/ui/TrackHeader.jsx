import React, { memo, useState } from 'react';
import { FiX } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import InlineName from './InlineName';
import { LANE_HEIGHT } from './snap';

function formatPan(pan) {
  const v = Math.round(pan * 100);
  if (v === 0) return 'C';
  return v < 0 ? `L${-v}` : `R${v}`;
}

/**
 * Track header row (left column): name, mute/solo, volume, pan, delete.
 * Same height as its lane so rows line up without any measuring.
 */
export default memo(function TrackHeader({ track, audible, selected, onSelect, onUpdate, onDelete }) {
  const [asking, setAsking] = useState(false);
  const clipCount = track.clips.length;
  const set = (patch) => onUpdate(track.id, patch);

  const requestDelete = () => {
    if (clipCount === 0) onDelete(track.id);
    else setAsking(true);
  };

  return (
    <div
      onPointerDown={() => onSelect(track.id)}
      className={`flex flex-col justify-center gap-1 border-b border-line px-2 md:px-3 ${selected ? 'bg-hover' : 'bg-paper'}`}
      style={{ height: LANE_HEIGHT }}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <InlineName
          value={track.name}
          label="Track name"
          onCommit={(name) => set({ name })}
          className={`flex-1 ${audible ? '' : '!text-muted'}`}
          inputClassName="min-w-0 flex-1"
        />
        <div className="flex shrink-0 items-baseline gap-2 text-caption">
          <TextButton
            muted
            current={track.muted}
            aria-pressed={track.muted}
            onClick={() => set({ muted: !track.muted })}
            title="Mute"
            label="M"
          >
            M
          </TextButton>
          <TextButton
            muted
            current={track.soloed}
            aria-pressed={track.soloed}
            onClick={() => set({ soloed: !track.soloed })}
            title="Solo"
            label="S"
          >
            S
          </TextButton>
          <TextButton muted onClick={requestDelete} title="Delete track" aria-label={`Delete ${track.name}`} label="">
            <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
          </TextButton>
        </div>
      </div>

      {asking ? (
        <div className="flex flex-col text-caption" onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}>
          <span className="text-muted">
            Delete with {clipCount} {clipCount === 1 ? 'clip' : 'clips'}?
          </span>
          <span className="flex gap-3">
            <TextButton autoFocus onClick={() => onDelete(track.id)}>
              Confirm
            </TextButton>
            <TextButton muted onClick={() => setAsking(false)}>
              Cancel
            </TextButton>
          </span>
        </div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-caption text-muted" title="Volume (double-click resets)">
            <span className="w-7 shrink-0">Vol</span>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.01"
              value={track.volume}
              onChange={(e) => set({ volume: parseFloat(e.target.value) })}
              onDoubleClick={() => set({ volume: 1 })}
              className="slider min-w-0"
              aria-label={`${track.name} volume`}
            />
            <span className="w-8 shrink-0 text-right tabular-nums">{Math.round(track.volume * 100)}</span>
          </label>
          <label className="flex items-center gap-2 text-caption text-muted" title="Pan (double-click centres)">
            <span className="w-7 shrink-0">Pan</span>
            <input
              type="range"
              min="-1"
              max="1"
              step="0.01"
              value={track.pan}
              onChange={(e) => set({ pan: parseFloat(e.target.value) })}
              onDoubleClick={() => set({ pan: 0 })}
              className="slider min-w-0"
              aria-label={`${track.name} pan`}
            />
            <span className="w-8 shrink-0 text-right tabular-nums">{formatPan(track.pan)}</span>
          </label>
        </>
      )}
    </div>
  );
});
