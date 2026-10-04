import React from 'react';
import { FiX } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { CommitField, Group } from './fields';
import InlineName from './InlineName';
import { formatBarBeat, parseBarBeat } from './snap';

const SIGNATURES = Array.from({ length: 16 }, (_, i) => i + 1);
const btn = '[@media(pointer:coarse)]:min-h-[44px] justify-center';

/**
 * Project-level settings shown when no clip is selected (desktop dock) or
 * in a sheet (phone/tablet): loop region numerically, time signature,
 * markers (add at playhead, jump, rename, delete), and the shortcuts.
 */
export default function ProjectPanel({ project, variant = 'dock', onLoopChange, onMetaChange, onAddMarker, onJump, onRenameMarker, onDeleteMarker, showHints }) {
  const bpb = project.beats_per_bar || 4;
  const loop = project.loop;
  const sheet = variant === 'sheet';
  const parse = (t) => parseBarBeat(t, bpb);
  const markers = project.markers || [];

  return (
    <div className={sheet ? 'flex flex-col gap-3 px-4 py-3' : 'flex flex-col gap-1'}>
      <div className={sheet ? 'grid grid-cols-1 gap-3 min-[420px]:grid-cols-2' : 'flex flex-wrap items-start gap-x-7 gap-y-1'}>
        <Group label="Loop (bar.beat)" title="Loop region; the handles on the ruler drag it too">
          <TextButton
            current={!!loop.enabled}
            aria-pressed={!!loop.enabled}
            onClick={() => onLoopChange({ ...loop, enabled: !loop.enabled })}
            label="Off"
            className={btn}
          >
            {loop.enabled ? 'On' : 'Off'}
          </TextButton>
          <CommitField
            value={loop.start_beat}
            label="Loop start (bar.beat)"
            format={(v) => formatBarBeat(v, bpb)}
            parse={(t) => {
              const b = parse(t);
              return b !== null && b < loop.end_beat ? b : null;
            }}
            onCommit={(b) => onLoopChange({ ...loop, start_beat: b })}
            className="w-14"
          />
          <span className="text-caption text-muted">to</span>
          <CommitField
            value={loop.end_beat}
            label="Loop end (bar.beat)"
            format={(v) => formatBarBeat(v, bpb)}
            parse={(t) => {
              const b = parse(t);
              return b !== null && b > loop.start_beat ? b : null;
            }}
            onCommit={(b) => onLoopChange({ ...loop, end_beat: b })}
            className="w-14"
          />
          <span className="whitespace-nowrap text-caption text-muted">
            {Math.round(((loop.end_beat - loop.start_beat) / bpb) * 100) / 100} bars
          </span>
        </Group>

        <Group label="Time signature">
          <select
            value={bpb}
            onChange={(e) => onMetaChange({ beats_per_bar: Number(e.target.value) })}
            aria-label="Beats per bar"
            className="ainput w-14 !pb-0.5 [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:text-p"
          >
            {SIGNATURES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="text-caption text-muted">/ 4</span>
        </Group>

        <Group label={`Markers · ${markers.length}`} className="min-w-0 max-w-full">
          <TextButton muted onClick={onAddMarker} className={btn} title="Add a marker at the playhead">
            Add at playhead
          </TextButton>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0">
            {markers.map((m) => (
              <span key={m.id} className="inline-flex items-center gap-1 text-caption">
                <InlineName
                  value={m.name || 'Marker'}
                  label="Marker name"
                  onCommit={(name) => onRenameMarker(m.id, name)}
                  className="max-w-[10rem] text-caption [@media(pointer:coarse)]:min-h-[44px]"
                  inputClassName="w-28 text-caption"
                />
                <TextButton
                  muted
                  onClick={() => onJump(m.beat)}
                  title="Jump to this marker"
                  className="tabular-nums [@media(pointer:coarse)]:min-h-[44px] justify-center"
                >
                  {formatBarBeat(m.beat, bpb)}
                </TextButton>
                <TextButton
                  muted
                  label=""
                  onClick={() => onDeleteMarker(m.id)}
                  aria-label={`Delete marker ${m.name || formatBarBeat(m.beat, bpb)}`}
                  className="items-center justify-center [@media(pointer:coarse)]:min-h-[44px] [@media(pointer:coarse)]:min-w-[44px]"
                >
                  <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
                </TextButton>
              </span>
            ))}
          </div>
        </Group>
      </div>
      {showHints && (
        <p className="m-0 truncate text-caption">
          Click a clip to edit · drag an empty lane to select · S splits · Ctrl/Cmd+C/V copy/paste · ←/→ nudge · L loop · Home · +/− zoom · Space
        </p>
      )}
    </div>
  );
}
