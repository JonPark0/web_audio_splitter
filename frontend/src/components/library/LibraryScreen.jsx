import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeSample,
  deleteSample,
  errorMessage,
  importSample,
  listSamples,
  listTags,
  updateSample,
} from '../../samplesApi';
import ErrorBanner from '../ErrorBanner';
import TextButton from '../TextButton';
import LibraryFilters from './LibraryFilters';
import SampleRow from './SampleRow';
import usePreview from './usePreview';

const POLL_MS = 2000;
const DEBOUNCE_MS = 300;

const EMPTY_FILTERS = { q: '', tag: '', key: '', bpmMin: '', bpmMax: '', sort: 'newest' };

function useDebounced(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// Reuse the previous object for samples that didn't change, so polling only
// re-renders rows whose data actually moved (SampleRow is memoized).
function reconcile(prev, next) {
  const byId = new Map(prev.map((s) => [s.id, s]));
  return next.map((s) => {
    const old = byId.get(s.id);
    return old && JSON.stringify(old) === JSON.stringify(s) ? old : s;
  });
}

export default function LibraryScreen() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [samples, setSamples] = useState([]);
  const [tags, setTags] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const { audioRef, playingId, toggle, stop } = usePreview({ onError: setError });

  // Typed fields wait for a pause; selects apply immediately.
  const q = useDebounced(filters.q, DEBOUNCE_MS);
  const bpmMin = useDebounced(filters.bpmMin, DEBOUNCE_MS);
  const bpmMax = useDebounced(filters.bpmMax, DEBOUNCE_MS);
  const { tag, key, sort } = filters;
  const query = useMemo(() => ({ q, tag, key, bpmMin, bpmMax, sort }), [q, tag, key, bpmMin, bpmMax, sort]);
  const filtersActive = Boolean(filters.q || filters.tag || filters.key || filters.bpmMin || filters.bpmMax);

  // listSeq drops responses superseded by a newer request (filter changes);
  // mutationSeq catches a list request that was already in flight when a
  // PATCH/DELETE/import landed - applying it would revert that change.
  const listSeqRef = useRef(0);
  const mutationSeqRef = useRef(0);
  const fetchSamplesRef = useRef(null);

  const fetchSamples = useCallback(async () => {
    const seq = ++listSeqRef.current;
    const mutation = mutationSeqRef.current;
    try {
      const res = await listSamples(query);
      if (seq !== listSeqRef.current) return;
      if (mutation !== mutationSeqRef.current) {
        await fetchSamplesRef.current();
        return;
      }
      setSamples((prev) => reconcile(prev, res.data?.samples || []));
      setLoaded(true);
    } catch (err) {
      if (seq === listSeqRef.current) setError(errorMessage(err, 'Could not load samples'));
    }
  }, [query]);
  fetchSamplesRef.current = fetchSamples;

  const fetchTags = useCallback(async () => {
    try {
      const res = await listTags();
      setTags(res.data?.tags || []);
    } catch (err) {
      setError(errorMessage(err, 'Could not load tags'));
    }
  }, []);

  useEffect(() => {
    fetchSamples();
  }, [fetchSamples]);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // Self-scheduling poll while analysis runs: the next request is queued only
  // after the previous one settles, and the loop ends once nothing is pending.
  const anyPending = samples.some((s) => s.analysis_status === 'pending');
  useEffect(() => {
    if (!anyPending) return undefined;
    let cancelled = false;
    let timer;
    const tick = async () => {
      await fetchSamplesRef.current();
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [anyPending]);

  // Stop if the playing sample leaves the list (deleted or filtered out) -
  // its stop control would be gone with it.
  useEffect(() => {
    if (playingId && !samples.some((s) => s.id === playingId)) stop();
  }, [playingId, samples, stop]);

  const replaceSample = useCallback((updated) => {
    mutationSeqRef.current += 1;
    setSamples((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
  }, []);

  const handlePatch = useCallback(
    async (id, changes) => {
      try {
        const res = await updateSample(id, changes);
        replaceSample(res.data);
        if ('tags' in changes) fetchTags();
      } catch (err) {
        setError(errorMessage(err, 'Could not update the sample'));
      }
    },
    [replaceSample, fetchTags]
  );

  const handleAnalyze = useCallback(
    async (id) => {
      try {
        const res = await analyzeSample(id);
        replaceSample(res.data);
      } catch (err) {
        setError(errorMessage(err, 'Could not start analysis'));
      }
    },
    [replaceSample]
  );

  const handleDelete = useCallback(
    async (id) => {
      try {
        await deleteSample(id);
        mutationSeqRef.current += 1;
        setSamples((prev) => prev.filter((s) => s.id !== id));
        fetchTags();
      } catch (err) {
        setError(errorMessage(err, 'Could not delete the sample'));
      }
    },
    [fetchTags]
  );

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setImporting(true);
    try {
      await importSample({ file });
      mutationSeqRef.current += 1;
      // Via the ref: filters may have changed while the upload was in flight.
      await Promise.all([fetchSamplesRef.current(), fetchTags()]);
    } catch (err) {
      setError(errorMessage(err, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  // Words only, like Palnarium's "Add New Image": the icon added nothing the
  // word doesn't already say.
  const importButton = (
    <TextButton onClick={() => fileInputRef.current?.click()} disabled={importing}>
      {importing ? 'Importing…' : 'Import File'}
    </TextButton>
  );

  return (
    <div className="flex w-full flex-col">
      {/* Palnarium content head: frame width, s-8 above, s-10 below */}
      <div className="mx-auto mb-20 mt-16 max-w-frame text-center">
        <h1 className="m-0 mb-3 text-title-sm font-light md:text-title">Sample Library</h1>
        <p className="m-0 mb-4 text-h3">
          {loaded ? `${samples.length} ${samples.length === 1 ? 'sample' : 'samples'}` : ' '}
        </p>
        <p className="m-0 text-muted">Regions cut from your stems, with tempo and key.</p>
        <div className="mt-6">{importButton}</div>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aac,.aiff,.aif"
          onChange={handleImport}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
      </div>

      <div className="flex flex-col gap-6">
        <ErrorBanner message={error} onDismiss={() => setError(null)} />

        <LibraryFilters
          filters={filters}
          tags={tags}
          onChange={setFilters}
          onClear={() => setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }))}
          active={filtersActive}
        />

        {/* States are one quiet sentence, no rules (Palnarium .list__empty). */}
        {!loaded ? (
          <div className="flex justify-center py-10 text-muted">
            {error ? (
              <TextButton
                onClick={() => {
                  setError(null);
                  fetchSamples();
                  fetchTags();
                }}
              >
                Retry
              </TextButton>
            ) : (
              <p className="m-0">Loading…</p>
            )}
          </div>
        ) : samples.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            {filtersActive ? (
              <>
                <p className="m-0 text-muted">No samples match these filters.</p>
                <TextButton onClick={() => setFilters((f) => ({ ...EMPTY_FILTERS, sort: f.sort }))}>
                  Clear filters
                </TextButton>
              </>
            ) : (
              <>
                <p className="m-0 text-muted">No samples yet.</p>
                {/* how to get started is read to act on, so it stays ink */}
                <p className="m-0 max-w-measure">
                  Select a region on a stem in the Split screen to extract it here, or import an audio file.
                </p>
              </>
            )}
          </div>
        ) : (
          // Editable rows = Palnarium admin rows: a hairline *between* rows
          // only, never capping the list.
          <div className="flex flex-col divide-y divide-line">
            {samples.map((s) => (
              <SampleRow
                key={s.id}
                sample={s}
                playing={s.id === playingId}
                audioRef={audioRef}
                onTogglePlay={toggle}
                onPatch={handlePatch}
                onAnalyze={handleAnalyze}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
