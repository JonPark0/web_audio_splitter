import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FiPlay, FiSquare } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import usePreview from '../../components/library/usePreview';
import { formatBpm, formatDuration } from '../../components/library/format';
import { errorMessage, listSamples } from '../../samplesApi';
import { SAMPLE_MIME, sampleDrag } from './sampleDrag';

const DEBOUNCE_MS = 300;

const SampleItem = memo(function SampleItem({ sample, playing, onTogglePlay, onAdd }) {
  const meta = [
    sample.bpm != null ? `${formatBpm(sample.bpm)} BPM` : 'No BPM',
    sample.key,
    formatDuration(sample.duration_sec),
  ].filter(Boolean);

  return (
    <li
      draggable
      onDragStart={(e) => {
        sampleDrag.current = sample;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(SAMPLE_MIME, JSON.stringify(sample));
        e.dataTransfer.setData('text/plain', sample.name);
      }}
      onDragEnd={() => {
        sampleDrag.current = null;
      }}
      title="Drag onto a track"
      className="flex cursor-grab items-center gap-3 py-2 transition-opacity duration-140 hover:opacity-55 active:cursor-grabbing"
    >
      <TextButton
        onClick={() => onTogglePlay(sample)}
        label=""
        aria-label={playing ? `Stop ${sample.name}` : `Preview ${sample.name}`}
        aria-pressed={playing}
        title={playing ? 'Stop preview' : 'Preview'}
        current={playing}
        className="shrink-0 pl-1"
      >
        {playing ? (
          <FiSquare className="icon" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <FiPlay className="icon" strokeWidth={1.5} aria-hidden="true" />
        )}
      </TextButton>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate leading-tight">{sample.name}</span>
        <span className="truncate text-caption tabular-nums text-muted">{meta.join(' · ')}</span>
      </div>
      <TextButton
        muted
        onClick={() => onAdd(sample)}
        title="Add at the playhead on the selected track"
        className="shrink-0 pr-1 text-caption"
      >
        Add
      </TextButton>
    </li>
  );
});

/**
 * Library samples to arrange: debounced search, drag a row onto a lane, or
 * "Add" to place it at the playhead. Optional preview through the same
 * single-Audio-element hook the Library uses.
 */
export default function SampleBrowser({ onAdd, onError }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [samples, setSamples] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const seqRef = useRef(0);
  const { playingId, toggle, stop } = usePreview({ onError });

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  const fetchSamples = useCallback(async () => {
    const seq = ++seqRef.current;
    try {
      const res = await listSamples({ q: debouncedQ, sort: 'newest' });
      if (seq !== seqRef.current) return; // superseded by a newer search
      setSamples(res.data?.samples || []);
      setStatus('ready');
    } catch (err) {
      if (seq !== seqRef.current) return;
      setStatus('error');
      onError?.(errorMessage(err, 'Could not load samples'));
    }
  }, [debouncedQ, onError]);

  useEffect(() => {
    fetchSamples();
  }, [fetchSamples]);

  // Stop a preview whose row disappeared from the results.
  useEffect(() => {
    if (playingId && !samples.some((s) => s.id === playingId)) stop();
  }, [playingId, samples, stop]);

  return (
    <section aria-label="Sample browser" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="m-0 text-h4 font-light">Samples</h2>
        <span className="text-caption text-muted">{status === 'ready' ? samples.length : ''}</span>
      </div>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search samples"
        aria-label="Search samples"
        className="ainput"
      />
      <div className="max-h-[420px] overflow-y-auto lg:max-h-[560px]">
        {status === 'loading' && <p className="m-0 py-4 text-caption text-muted">Loading…</p>}
        {status === 'error' && (
          <p className="m-0 flex items-baseline gap-3 py-4 text-caption">
            Could not load samples.
            <TextButton onClick={fetchSamples}>Retry</TextButton>
          </p>
        )}
        {status === 'ready' && samples.length === 0 && (
          // Status muted, how to get started ink (read to act on), as in the Library.
          <div className="flex flex-col gap-1 py-4 text-caption">
            <p className="m-0 text-muted">{debouncedQ ? 'No samples match.' : 'No samples yet.'}</p>
            {!debouncedQ && <p className="m-0">Extract some in Split or import them in the Library.</p>}
          </div>
        )}
        {status === 'ready' && samples.length > 0 && (
          // A hairline between rows only, never capping the list.
          <ul className="m-0 list-none divide-y divide-line p-0">
            {samples.map((s) => (
              <SampleItem key={s.id} sample={s} playing={s.id === playingId} onTogglePlay={toggle} onAdd={onAdd} />
            ))}
          </ul>
        )}
      </div>
      <p className="m-0 text-caption max-lg:hidden">Drag a sample onto a track, or Add it at the playhead.</p>
    </section>
  );
}
