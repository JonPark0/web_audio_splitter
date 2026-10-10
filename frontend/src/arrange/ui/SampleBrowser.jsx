import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FiPlay, FiSquare } from 'react-icons/fi';
import TextButton from '../../components/TextButton';
import { errorMessage, listSamples } from '../../samplesApi';
import { sampleAudioUrl } from '../projectsApi';
import { SAMPLE_MIME, sampleDrag } from './sampleDrag';
import { formatBpm } from './snap';

const DEBOUNCE_MS = 300;

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '';
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 2 : 1)} s`;
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec - m * 60)).padStart(2, '0')}`;
}

/** One shared <audio> for previews: starting a sample replaces whatever played. */
function usePreviewAudio(onError) {
  const audioRef = useRef(null);
  const [playingId, setPlayingId] = useState(null);
  const playingRef = useRef(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    playingRef.current = null;
    setPlayingId(null);
  }, []);
  const toggle = useCallback(
    (sample) => {
      if (playingRef.current === sample.id) {
        stop();
        return;
      }
      if (!audioRef.current) {
        const a = new Audio();
        a.addEventListener('ended', () => {
          playingRef.current = null;
          setPlayingId(null);
        });
        audioRef.current = a;
      }
      const a = audioRef.current;
      a.pause();
      a.src = sampleAudioUrl(sample);
      playingRef.current = sample.id;
      setPlayingId(sample.id);
      a.play().catch((e) => {
        if (e?.name === 'AbortError') return;
        stop();
        onErrorRef.current?.('Could not play this sample');
      });
    },
    [stop]
  );
  useEffect(() => stop, [stop]);
  return { playingId, toggle, stop };
}

const SampleItem = memo(function SampleItem({ sample, playing, coarse, onTogglePlay, onAdd, onArm }) {
  const meta = [sample.bpm != null ? `${formatBpm(sample.bpm)} BPM` : 'No BPM', sample.key, formatDuration(sample.duration_sec)].filter(
    Boolean
  );
  return (
    <li
      draggable={!coarse}
      onDragStart={(e) => {
        sampleDrag.current = sample;
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(SAMPLE_MIME, JSON.stringify(sample));
        e.dataTransfer.setData('text/plain', sample.name);
      }}
      onDragEnd={() => {
        sampleDrag.current = null;
      }}
      title={coarse ? 'Tap to place on a lane' : 'Drag onto a track'}
      className={`flex items-center gap-2 ${coarse ? 'min-h-[56px]' : 'min-h-[40px] cursor-grab active:cursor-grabbing'}`}
    >
      <TextButton
        onClick={() => onTogglePlay(sample)}
        label=""
        aria-label={playing ? `Stop ${sample.name}` : `Preview ${sample.name}`}
        aria-pressed={playing}
        title={playing ? 'Stop preview' : 'Preview'}
        current={playing}
        className="min-h-[32px] min-w-[28px] shrink-0 items-center justify-center coarse:min-h-[44px] coarse:min-w-[44px]"
      >
        {playing ? <FiSquare className="icon" strokeWidth={1.5} aria-hidden="true" /> : <FiPlay className="icon" strokeWidth={1.5} aria-hidden="true" />}
      </TextButton>
      {coarse ? (
        <button
          type="button"
          onClick={() => onArm(sample)}
          title="Tap, then tap a lane to place it"
          className="flex min-h-[44px] min-w-0 flex-1 flex-col items-start justify-center border-0 bg-transparent p-0 text-left text-ink"
        >
          <span className="w-full truncate leading-tight">{sample.name}</span>
          <span className="w-full truncate text-caption tabular-nums text-muted">{meta.join(' · ')}</span>
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col transition-opacity duration-140 hover:opacity-55">
          <span className="truncate leading-tight">{sample.name}</span>
          <span className="truncate text-caption tabular-nums text-muted">{meta.join(' · ')}</span>
        </div>
      )}
      <TextButton
        muted
        onClick={() => onAdd(sample)}
        title="Add at the playhead on the selected track"
        className="shrink-0 pr-1 text-caption coarse:min-h-[44px] coarse:min-w-[44px] justify-center"
      >
        Add
      </TextButton>
    </li>
  );
});

/**
 * Library samples to arrange: debounced search; with a mouse drag a row onto
 * a lane (or click / Add to place it at the playhead); on touch tap a row,
 * then tap a lane to place it. Preview plays through one shared element.
 */
export default function SampleBrowser({ onAdd, onArm, onError, coarse, className = '' }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [samples, setSamples] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const seqRef = useRef(0);
  const { playingId, toggle, stop } = usePreviewAudio(onError);

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

  useEffect(() => {
    if (playingId && !samples.some((s) => s.id === playingId)) stop();
  }, [playingId, samples, stop]);

  const arm = (s) => {
    stop();
    onArm?.(s);
  };

  return (
    <section aria-label="Sample browser" className={`flex min-h-0 min-w-0 flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search samples"
          aria-label="Search samples"
          className="ainput !pb-1 coarse:min-h-[44px] coarse:text-p"
        />
        <span className="shrink-0 text-caption tabular-nums text-muted">{status === 'ready' ? samples.length : ''}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {status === 'loading' && <p className="m-0 py-3 text-caption text-muted">Loading…</p>}
        {status === 'error' && (
          <p className="m-0 flex items-baseline gap-3 py-3 text-caption">
            Could not load samples.
            <TextButton onClick={fetchSamples}>Retry</TextButton>
          </p>
        )}
        {status === 'ready' && samples.length === 0 && (
          <div className="flex flex-col gap-1 py-3 text-caption">
            <p className="m-0 text-muted">{debouncedQ ? 'No samples match.' : 'No samples yet.'}</p>
            {!debouncedQ && <p className="m-0">Extract some in Split or import them in the Library.</p>}
          </div>
        )}
        {status === 'ready' && samples.length > 0 && (
          <ul className="m-0 list-none divide-y divide-line p-0">
            {samples.map((s) => (
              <SampleItem
                key={s.id}
                sample={s}
                playing={s.id === playingId}
                coarse={coarse}
                onTogglePlay={toggle}
                onAdd={onAdd}
                onArm={arm}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
