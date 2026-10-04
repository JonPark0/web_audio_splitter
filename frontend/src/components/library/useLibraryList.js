import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { errorMessage, getSample, listSamples } from '../../samplesApi';

export const PAGE_SIZE = 100;
const POLL_MS = 2000;
const POLL_BATCH = 8; // at most this many GET /samples/{id} per tick
const POLL_LIST_OVER = 24; // more pending than this: re-read the loaded list instead

// The last list shown, so coming back from another section draws at once
// (then refreshes) and the saved scroll position has rows to land on.
let lastView = null; // { key, samples, matched, total }

export function filterKey(f) {
  return JSON.stringify([f.q, f.tags, f.key, f.bpmMin, f.bpmMax, f.sort]);
}

// Reuse the previous object for samples that didn't change, so a refresh
// only re-renders rows whose data actually moved (rows are memoized).
function reconcile(prev, next) {
  if (!prev.length) return next;
  const byId = new Map(prev.map((s) => [s.id, s]));
  return next.map((s) => {
    const old = byId.get(s.id);
    return old && JSON.stringify(old) === JSON.stringify(s) ? old : s;
  });
}

function sameSample(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The filtered list, paged (E1): the first PAGE_SIZE rows (or as many as
 * were loaded before, to restore scroll), more on loadMore(). While samples
 * analyse, only those ids are polled - never the whole list (E3) - and not
 * while the tab is hidden.
 */
export default function useLibraryList(filters, { restoreCount = 0 } = {}) {
  const key = filterKey(filters);
  const [state, setState] = useState(() =>
    lastView && lastView.key === key
      ? { ...lastView, loaded: true, error: null, loadingMore: false }
      : { key, samples: [], matched: null, total: null, loaded: false, error: null, loadingMore: false }
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  // The restore size applies to the query we mounted with, until it changes
  // (not zeroed inside the effect: StrictMode runs effects twice).
  const restoreRef = useRef({ key, count: restoreCount });

  // listSeq drops responses superseded by a newer request (filter change);
  // mutationSeq catches a response that was in flight when a local change
  // (PATCH result, delete, import) landed - applying it would revert that.
  const listSeqRef = useRef(0);
  const mutationSeqRef = useRef(0);

  const fetchFirst = useCallback(async (limit) => {
    const seq = ++listSeqRef.current;
    const mutation = mutationSeqRef.current;
    const f = filtersRef.current;
    const k = filterKey(f);
    try {
      const res = await listSamples({ ...f, limit, offset: 0 });
      if (seq !== listSeqRef.current) return;
      if (mutation !== mutationSeqRef.current) {
        fetchFirst(limit);
        return;
      }
      const data = res.data || {};
      const rows = data.samples || [];
      setState((prev) => ({
        key: k,
        samples: reconcile(prev.samples, rows),
        // An older backend returns everything and no counts.
        matched: data.matched ?? rows.length,
        total: data.total ?? rows.length,
        loaded: true,
        error: null,
        loadingMore: false,
      }));
    } catch (err) {
      if (seq !== listSeqRef.current) return;
      setState((prev) => ({ ...prev, error: errorMessage(err, 'Could not load samples') }));
    }
  }, []);

  // Filters changed (or first mount): load the first page.
  useEffect(() => {
    const restore = restoreRef.current.key === key ? restoreRef.current.count || 0 : 0;
    if (restoreRef.current.key !== key) restoreRef.current = { key: null, count: 0 };
    const limit = Math.max(PAGE_SIZE, Math.min(1000, restore));
    // The previous rows stay up until the new ones land (no flash of
    // "Loading" on every keystroke); `stale` says they're outdated.
    fetchFirst(limit);
  }, [key, fetchFirst]);

  useEffect(() => {
    if (state.loaded) lastView = { key: state.key, samples: state.samples, matched: state.matched, total: state.total };
  }, [state]);

  const hasMore = state.loaded && state.matched != null && state.samples.length < state.matched;

  const loadMore = useCallback(async () => {
    const cur = stateRef.current;
    if (cur.loadingMore || !cur.loaded || cur.matched == null || cur.samples.length >= cur.matched) return;
    const seq = listSeqRef.current;
    const k = cur.key;
    setState((prev) => ({ ...prev, loadingMore: true }));
    try {
      const res = await listSamples({ ...filtersRef.current, limit: PAGE_SIZE, offset: cur.samples.length });
      if (seq !== listSeqRef.current) return;
      const rows = res.data?.samples || [];
      setState((prev) => {
        if (prev.key !== k) return prev;
        const have = new Set(prev.samples.map((s) => s.id));
        return {
          ...prev,
          samples: [...prev.samples, ...rows.filter((s) => !have.has(s.id))],
          matched: res.data?.matched ?? prev.matched,
          total: res.data?.total ?? prev.total,
          loadingMore: false,
        };
      });
    } catch (err) {
      if (seq !== listSeqRef.current) return;
      setState((prev) => ({ ...prev, loadingMore: false, error: errorMessage(err, 'Could not load more samples') }));
    }
  }, []);

  /** Re-read everything loaded so far (after imports / bulk changes). */
  const refresh = useCallback(() => {
    const n = stateRef.current.samples.length;
    return fetchFirst(Math.max(PAGE_SIZE, Math.min(1000, n)));
  }, [fetchFirst]);

  const replace = useCallback((updated) => {
    mutationSeqRef.current += 1;
    setState((prev) => ({ ...prev, samples: prev.samples.map((s) => (s.id === updated.id ? updated : s)) }));
  }, []);

  const replaceMany = useCallback((updates) => {
    if (!updates.length) return;
    mutationSeqRef.current += 1;
    const byId = new Map(updates.map((u) => [u.id, u]));
    setState((prev) => ({ ...prev, samples: prev.samples.map((s) => byId.get(s.id) || s) }));
  }, []);

  const remove = useCallback((ids) => {
    const gone = new Set(ids);
    mutationSeqRef.current += 1;
    setState((prev) => {
      const samples = prev.samples.filter((s) => !gone.has(s.id));
      const removed = prev.samples.length - samples.length;
      return {
        ...prev,
        samples,
        matched: prev.matched == null ? null : Math.max(0, prev.matched - removed),
        total: prev.total == null ? null : Math.max(0, prev.total - gone.size),
      };
    });
  }, []);

  /** A new sample (import): shown at the top when that's where it sorts. */
  const add = useCallback((sample, { visible }) => {
    mutationSeqRef.current += 1;
    setState((prev) => ({
      ...prev,
      samples: visible ? [sample, ...prev.samples.filter((s) => s.id !== sample.id)] : prev.samples,
      matched: visible && prev.matched != null ? prev.matched + 1 : prev.matched,
      total: prev.total != null ? prev.total + 1 : prev.total,
    }));
  }, []);

  // --- polling only the samples still analysing ---------------------------
  const pendingKey = useMemo(
    () =>
      state.samples
        .filter((s) => s.analysis_status === 'pending')
        .map((s) => s.id)
        .join(','),
    [state.samples]
  );

  useEffect(() => {
    if (!pendingKey) return undefined;
    const ids = pendingKey.split(',');
    let cursor = 0;
    let cancelled = false;
    let timer = null;
    let running = false;

    // A bulk re-analysis puts many rows in flight: one list read of the
    // loaded window then beats dozens of single GETs.
    const many = ids.length > POLL_LIST_OVER;

    const tick = async () => {
      if (cancelled || running || document.hidden) return;
      running = true;
      if (many) {
        await refresh();
        running = false;
        return;
      }
      const batch = [];
      for (let i = 0; i < Math.min(POLL_BATCH, ids.length); i += 1) batch.push(ids[(cursor + i) % ids.length]);
      cursor = (cursor + batch.length) % ids.length;
      const results = await Promise.all(batch.map((id) => getSample(id).then((r) => r.data).catch(() => null)));
      running = false;
      if (cancelled) return;
      const current = new Map(stateRef.current.samples.map((s) => [s.id, s]));
      const changed = results.filter((s) => s && current.has(s.id) && !sameSample(current.get(s.id), s));
      if (changed.length) {
        const byId = new Map(changed.map((u) => [u.id, u]));
        // Not a "mutation": these are server truths, newer than any list.
        setState((prev) => ({ ...prev, samples: prev.samples.map((s) => byId.get(s.id) || s) }));
      }
    };

    timer = setInterval(tick, many ? POLL_MS * 2 : POLL_MS);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [pendingKey, refresh]);

  const setError = useCallback((error) => setState((prev) => ({ ...prev, error })), []);

  return {
    samples: state.samples,
    matched: state.matched,
    total: state.total,
    loaded: state.loaded,
    stale: state.key !== key,
    loadingMore: state.loadingMore,
    error: state.error,
    hasMore,
    loadMore,
    refresh,
    replace,
    replaceMany,
    remove,
    add,
    setError,
  };
}
