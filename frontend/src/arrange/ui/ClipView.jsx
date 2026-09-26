import React, { memo } from 'react';
import ClipWaveform from './ClipWaveform';

const LABEL_HEIGHT = 20;
const LABEL_GAP = 4; // label -> waveform, and the waveform's inset without a label
const TRIM_HANDLE_PX = 8;

/**
 * One clip block. Pure presentation: position/size come from the Timeline
 * (which already applied any drag preview), and pointer-downs are reported
 * up with the grabbed part ('move' body, 'trimStart' left edge, 'trim'
 * right edge).
 */
export default memo(function ClipView({
  clip,
  sample,
  left,
  top,
  width,
  height,
  offsetSec,
  lengthSec,
  selected,
  dimmed,
  dragging,
  engine,
  onClipPointerDown,
}) {
  const name = sample?.name || 'Missing sample';
  const showLabel = width >= 24;
  const waveTop = showLabel ? LABEL_HEIGHT + LABEL_GAP : LABEL_GAP;

  return (
    <div
      data-clip={clip.id}
      role="button"
      tabIndex={-1}
      aria-pressed={selected}
      aria-label={`Clip ${name}`}
      title={name}
      onPointerDown={(e) => onClipPointerDown(e, clip, 'move')}
      // Edge drawn as an inset ink outline (no shadows in the system); a
      // selected clip thickens it like a focused field.
      className={`absolute cursor-grab overflow-hidden bg-wash outline outline-ink ${
        selected ? 'z-10 outline-2 -outline-offset-2' : 'outline-1 -outline-offset-1'
      } ${dimmed ? 'opacity-55' : ''} ${dragging ? 'cursor-grabbing opacity-80' : ''}`}
      style={{ left, top, width: Math.max(2, width), height, touchAction: 'none' }}
    >
      {showLabel && (
        <div
          className={`pointer-events-none truncate px-2 text-caption leading-body ${
            selected ? 'bg-ink text-paper' : 'text-ink'
          }`}
          style={{ height: LABEL_HEIGHT }}
        >
          {name}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-1" style={{ top: waveTop }}>
        <ClipWaveform
          engine={engine}
          sampleId={clip.sample_id}
          offsetSec={offsetSec ?? clip.offset_sec}
          lengthSec={lengthSec}
          width={width}
          height={height - waveTop - 4}
        />
      </div>
      {/* Edge trim handles (left only when the clip is wide enough to still grab its body);
          hover thickens the edge to 2px ink, like a focused field */}
      {width >= TRIM_HANDLE_PX * 3 && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => {
            e.stopPropagation();
            onClipPointerDown(e, clip, 'trimStart');
          }}
          className="absolute inset-y-0 left-0 cursor-ew-resize hover:border-l-2 hover:border-ink"
          style={{ width: TRIM_HANDLE_PX }}
        />
      )}
      <div
        aria-hidden="true"
        onPointerDown={(e) => {
          e.stopPropagation();
          onClipPointerDown(e, clip, 'trim');
        }}
        className="absolute inset-y-0 right-0 cursor-ew-resize hover:border-r-2 hover:border-ink"
        style={{ width: TRIM_HANDLE_PX }}
      />
    </div>
  );
});
