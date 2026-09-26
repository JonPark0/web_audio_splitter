import React, { memo } from 'react';
import ClipWaveform from './ClipWaveform';

const LABEL_HEIGHT = 18;
const TRIM_HANDLE_PX = 7;

/**
 * One clip block. Pure presentation: position/size come from the Timeline
 * (which already applied any drag preview), and pointer-downs are reported
 * up with the grabbed part ('move' body or 'trim' right edge).
 */
export default memo(function ClipView({
  clip,
  sample,
  left,
  top,
  width,
  height,
  lengthSec,
  selected,
  dimmed,
  dragging,
  engine,
  onClipPointerDown,
}) {
  const name = sample?.name || 'Missing sample';
  const showLabel = width >= 24;

  return (
    <div
      data-clip={clip.id}
      role="button"
      tabIndex={-1}
      aria-pressed={selected}
      aria-label={`Clip ${name}`}
      title={name}
      onPointerDown={(e) => onClipPointerDown(e, clip, 'move')}
      className={`absolute cursor-grab overflow-hidden bg-hover ${
        selected ? 'z-10 shadow-[inset_0_0_0_2px_#141414]' : 'shadow-[inset_0_0_0_1px_#141414]'
      } ${dimmed ? 'opacity-40' : ''} ${dragging ? 'cursor-grabbing opacity-80' : ''}`}
      style={{ left, top, width: Math.max(2, width), height, touchAction: 'none' }}
    >
      {showLabel && (
        <div
          className={`pointer-events-none truncate px-1.5 text-caption leading-[18px] ${
            selected ? 'bg-ink text-paper' : 'text-ink'
          }`}
          style={{ height: LABEL_HEIGHT }}
        >
          {name}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-1" style={{ top: showLabel ? LABEL_HEIGHT + 2 : 4 }}>
        <ClipWaveform
          engine={engine}
          sampleId={clip.sample_id}
          offsetSec={clip.offset_sec}
          lengthSec={lengthSec}
          width={width}
          height={height - (showLabel ? LABEL_HEIGHT + 2 : 4) - 4}
        />
      </div>
      {/* Right-edge trim handle */}
      <div
        aria-hidden="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          onClipPointerDown(e, clip, 'trim');
        }}
        className="absolute inset-y-0 right-0 cursor-ew-resize hover:bg-ink/20"
        style={{ width: TRIM_HANDLE_PX }}
      />
    </div>
  );
});
