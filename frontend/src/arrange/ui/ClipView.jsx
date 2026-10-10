import React, { memo } from 'react';
import { isLooped, secondsToBeats } from '../project';
import ClipWaveform from './ClipWaveform';

const LABEL_HEIGHT = 16;
const FADE_HANDLE_PX = 9;

const PENDING_STYLE = {
  backgroundImage: 'repeating-linear-gradient(45deg, var(--muted) 0 1px, transparent 1px 6px)',
};

/**
 * One clip block. Pure presentation: position/size come from the Timeline
 * (which already applied any drag preview), and pointer-downs are reported
 * up with the grabbed part ('move' body, 'trimStart'/'trim' edges,
 * 'fadeIn'/'fadeOut' top corners).
 *
 * Shows: name, waveform (loop repeats dimmed, reversed mirrored), fade
 * ramps, and a hatch while its server render is still on the way.
 * A swipe that starts here scrolls the timeline (`touchAction` pan, none
 * while a pen is in use); the Timeline lifts the clip only after a
 * long-press, and shows it `dragging` from that moment.
 * Keyboard: the Timeline picks the one clip with tabIndex 0 and draws the
 * focus ring; screen readers get name, `where` and the selected state.
 */
export default memo(function ClipView({
  clip,
  sample,
  bpm,
  pxPerBeat,
  left,
  top,
  width,
  regionWidth,
  height,
  selected,
  dimmed,
  dragging,
  overlapping,
  pending,
  coarse,
  handlePx,
  engine,
  where,
  tabIndex = -1,
  touchAction = 'pan-x pan-y',
  onClipPointerDown,
  onFocus,
  onBlur,
}) {
  const name = sample?.name || 'Missing sample';
  const showLabel = width >= 24 && height >= 34;
  const waveTop = showLabel ? LABEL_HEIGHT : 2;
  // Fade widths in px: timeline seconds -> beats -> px.
  const secToPx = (sec) => secondsToBeats(sec, bpm) * pxPerBeat;
  const fadeIn = Math.min(width, secToPx(clip.fade_in_sec || 0));
  const fadeOut = Math.min(width - fadeIn, secToPx(clip.fade_out_sec || 0));
  const looped = isLooped(clip);
  const mouseHandles = !coarse;

  const flags = [looped && 'loop', clip.reverse && 'rev', (clip.semitones || clip.cents) && pitchLabel(clip)].filter(Boolean);
  // The overlap hatch can't take the pointer (it would block the clips), so
  // the clip itself says it.
  const note = [pending && 'rendering…', overlapping && 'overlaps another clip: both play there'].filter(Boolean).join(' · ');

  return (
    <div
      data-clip={clip.id}
      role="button"
      tabIndex={tabIndex}
      aria-pressed={selected}
      aria-label={`Clip ${name}${where ? `, ${where}` : ''}${note ? ` (${note})` : ''}`}
      title={note ? `${name} — ${note}` : name}
      onPointerDown={(e) => onClipPointerDown(e, clip, 'move')}
      onFocus={onFocus}
      onBlur={onBlur}
      // Edge drawn as an inset ink outline (no shadows in the system); a
      // selected clip thickens it like a focused field.
      className={`absolute overflow-hidden bg-wash outline outline-ink ${coarse ? '' : 'cursor-grab'} ${
        selected ? 'z-10 outline-2 -outline-offset-2' : 'outline-1 -outline-offset-1'
      } ${dimmed ? 'opacity-55' : ''} ${dragging ? 'z-20 cursor-grabbing opacity-80' : ''}`}
      style={{ left, top, width: Math.max(2, width), height, touchAction }}
    >
      {showLabel && (
        <div
          className={`pointer-events-none flex items-center gap-1 truncate px-1.5 text-caption leading-none ${
            selected ? 'bg-ink text-paper' : 'text-ink'
          }`}
          style={{ height: LABEL_HEIGHT }}
        >
          <span className="truncate">{name}</span>
          {flags.length > 0 && width > 90 && <span className="shrink-0 opacity-70">· {flags.join(' · ')}</span>}
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0.5" style={{ top: waveTop }}>
        <ClipWaveform
          engine={engine}
          sampleId={clip.sample_id}
          offsetSec={clip.offset_sec}
          lengthSec={clip.length_sec}
          reverse={!!clip.reverse}
          regionWidth={regionWidth}
          width={width}
          height={Math.max(4, height - waveTop - 2)}
        />
      </div>
      {(fadeIn > 0.5 || fadeOut > 0.5) && (
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          width={Math.max(2, width)}
          height={height}
          viewBox={`0 0 ${Math.max(2, width)} ${height}`}
          preserveAspectRatio="none"
        >
          {fadeIn > 0.5 && <polyline points={`0,${height} ${fadeIn},${waveTop}`} fill="none" stroke="var(--ink)" strokeWidth="1" />}
          {fadeOut > 0.5 && (
            <polyline points={`${width - fadeOut},${waveTop} ${width},${height}`} fill="none" stroke="var(--ink)" strokeWidth="1" />
          )}
        </svg>
      )}
      {pending && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-end justify-end p-1" style={PENDING_STYLE}>
          {width > 80 && height >= 34 && <span className="bg-paper px-1 text-caption leading-none text-ink">Rendering…</span>}
        </div>
      )}
      {mouseHandles && width >= handlePx * 3 && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => onClipPointerDown(e, clip, 'trimStart')}
          className="absolute inset-y-0 left-0 cursor-ew-resize hover:border-l-2 hover:border-ink"
          style={{ width: handlePx }}
        />
      )}
      {mouseHandles && (
        <div
          aria-hidden="true"
          onPointerDown={(e) => onClipPointerDown(e, clip, 'trim')}
          className="absolute inset-y-0 right-0 cursor-ew-resize hover:border-r-2 hover:border-ink"
          title={looped ? 'Drag to repeat the loop' : 'Drag to trim'}
          style={{ width: width >= handlePx * 3 ? handlePx : Math.max(3, Math.floor(width / 3)) }}
        />
      )}
      {mouseHandles && selected && width >= 48 && height >= 34 && (
        <>
          <div
            aria-hidden="true"
            title="Fade in"
            onPointerDown={(e) => onClipPointerDown(e, clip, 'fadeIn')}
            className="absolute top-0 cursor-ew-resize border border-ink bg-paper"
            style={{ left: Math.min(width - FADE_HANDLE_PX * 2, Math.max(handlePx, fadeIn - FADE_HANDLE_PX / 2)), width: FADE_HANDLE_PX, height: FADE_HANDLE_PX }}
          />
          <div
            aria-hidden="true"
            title="Fade out"
            onPointerDown={(e) => onClipPointerDown(e, clip, 'fadeOut')}
            className="absolute top-0 cursor-ew-resize border border-ink bg-paper"
            style={{
              left: Math.max(FADE_HANDLE_PX, Math.min(width - handlePx - FADE_HANDLE_PX, width - fadeOut - FADE_HANDLE_PX / 2)),
              width: FADE_HANDLE_PX,
              height: FADE_HANDLE_PX,
            }}
          />
        </>
      )}
    </div>
  );
});

function pitchLabel(clip) {
  const st = clip.semitones || 0;
  const c = clip.cents || 0;
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
  return `${st ? `${sign(st)}${Math.abs(st)} st` : ''}${st && c ? ' ' : ''}${c ? `${sign(c)}${Math.abs(c)} ct` : ''}`;
}
