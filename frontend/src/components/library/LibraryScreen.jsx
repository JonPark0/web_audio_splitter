import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MOD, shortcutKey } from '../../keys';
import { href, setQuery, useRoute } from '../../router';
import {
  SORT_OPTIONS,
  analyzeSample,
  analyzeSamples,
  deleteSample,
  errorMessage,
  exportSamples,
  listSamples,
  listTags,
  sampleAudioUrl,
  sampleRenderUrl,
  updateSample,
} from '../../samplesApi';
import ErrorBanner from '../ErrorBanner';
import TextButton from '../TextButton';
import BulkBar, { BulkTagPanel } from './BulkBar';
import FilterSheet from './FilterSheet';
import { DropVeil, ImportPanel, useFileDrop, useImportQueue } from './ImportQueue';
import Inspector from './Inspector';
import NowPlaying from './NowPlaying';
import RowError from './RowError';
import SampleCard from './SampleCard';
import SampleRow from './SampleRow';
import { ActionList, BottomSheet, Popover, Toast } from './Sheet';
import TableHeader from './TableHeader';
import { DesktopToolbar, PhoneBar } from './Toolbar';
import { downloadAsNamed, saveBlob } from './download';
import { downloadName, plural } from './format';
import useLayout, { useStoredState } from './useLayout';
import useLibraryList from './useLibraryList';
import usePreview from './usePreview';
import useProjectTarget from './useProjectTarget';
import { COARSE } from './ui';

const HEADER_PX = 48; // the app header (h-12), sticky above us
const TOOLBAR_PX = 44;
const PHONE_BAR_PX = 52;
const VIEW_KEY = 'library:view';
const SORTS = new Set(SORT_OPTIONS.map((o) => o.value));

// --- URL <-> filters (B10: filters live in the hash, so tab switches,
// refresh and Back keep them) ---------------------------------------------
function parseFilters(query) {
  return {
    q: query.q || '',
    tags: (query.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    key: query.key || '',
    bpmMin: query.bpm_min || '',
    bpmMax: query.bpm_max || '',
    sort: SORTS.has(query.sort) ? query.sort : 'newest',
  };
}

function toQuery(patch) {
  const out = {};
  if ('q' in patch) out.q = patch.q.trim() || null;
  if ('tags' in patch) out.tags = patch.tags.length ? patch.tags.join(',') : null;
  if ('key' in patch) out.key = patch.key || null;
  if ('bpmMin' in patch) out.bpm_min = patch.bpmMin || null;
  if ('bpmMax' in patch) out.bpm_max = patch.bpmMax || null;
  if ('sort' in patch) out.sort = patch.sort === 'newest' ? null : patch.sort;
  return out;
}

const CLEAR = { q: null, tags: null, key: null, bpm_min: null, bpm_max: null };

function readView() {
  try {
    return JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null');
  } catch (e) {
    return null;
  }
}

function writeView(view) {
  try {
    sessionStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch (e) {
    // storage unavailable - no restore then
  }
}

// Run `fn` over items, `limit` at a time.
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const n = i++;
      results[n] = await fn(items[n], n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const CTX_KEYS = [
  'rowClick',
  'rowDoubleClick',
  'rowFocus',
  'cardTap',
  'togglePlay',
  'seek',
  'toggleCheck',
  'openMenu',
  'openActions',
  'setRenaming',
  'setConfirming',
  'patch',
  'analyze',
  'remove',
  'dismissError',
  'addToArrange',
  'download',
];

export default function LibraryScreen() {
  const route = useRoute();
  const filters = useMemo(() => parseFilters(route.query), [route.query]);
  const filtered = Boolean(filters.q || filters.tags.length || filters.key || filters.bpmMin || filters.bpmMax);
  const activeCount = [filters.q, filters.tags.length, filters.key, filters.bpmMin || filters.bpmMax].filter(Boolean).length;
  const onFilters = useCallback((patch) => setQuery(toQuery(patch)), []);
  const onClear = useCallback(() => setQuery(CLEAR), []);

  const { size, wide, keys } = useLayout();
  const phone = size === 'phone';

  // Restore the last view of this exact query (B10): rows loaded, scroll, selection.
  const qs = useMemo(() => new URLSearchParams(route.query).toString(), [route.query]);
  const [saved] = useState(() => {
    const v = readView();
    return v && v.qs === new URLSearchParams(route.query).toString() ? v : null;
  });
  const list = useLibraryList(filters, { restoreCount: saved?.count || 0 });
  const { samples } = list;

  const [allTags, setAllTags] = useState([]);
  const fetchTags = useCallback(async () => {
    try {
      const res = await listTags();
      setAllTags(res.data?.tags || []);
    } catch (e) {
      // the tag menu just stays as it was
    }
  }, []);
  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  // --- preferences --------------------------------------------------------
  const [camelot, setCamelot] = useStoredState('library:camelot', false);
  const [auto, setAuto] = useStoredState('library:auto', true);
  const [loop, setLoop] = useStoredState('library:loop', false);
  const [sync, setSync] = useStoredState('library:sync', false);
  const [manualBpm, setManualBpm] = useStoredState('library:syncBpm', 120);
  const [inspectorOpen, setInspectorOpen] = useStoredState('library:inspector', true);

  // --- audition (P1, P2) ----------------------------------------------------
  const { project, addSample } = useProjectTarget();
  const syncBpm = sync ? Number(project?.bpm ?? manualBpm) : null;
  const getUrl = useCallback(
    (s) => (syncBpm && s.bpm && syncBpm >= 20 && syncBpm <= 999 ? sampleRenderUrl(s, { bpm: syncBpm }) : null),
    [syncBpm]
  );
  const [banner, setBanner] = useState(null);
  const preview = usePreview({ onError: setBanner, getUrl, loop });
  const { playingId, loadingId, audioRef } = preview;

  // --- selection / row state ---------------------------------------------
  const [selectedId, setSelectedId] = useState(saved?.selectedId || null);
  const [checked, setChecked] = useState(() => new Set());
  // Phone: the Select button shows every card's checkbox before anything is
  // checked (long-press on a card still starts it too).
  const [selectMode, setSelectMode] = useState(false);
  const clearChecked = () => {
    setChecked(new Set());
    setSelectMode(false);
  };
  const anchorRef = useRef(null);
  const [renamingId, setRenamingId] = useState(null);
  const [confirmingId, setConfirmingId] = useState(null);
  const [rowErrors, setRowErrors] = useState({});
  const [busyIds, setBusyIds] = useState({});
  const [menu, setMenu] = useState(null); // { id, rect }
  const [sheet, setSheet] = useState(null); // { type: 'inspector'|'actions'|'confirm'|'filters', id }
  const [toast, setToast] = useState(null);
  const closeToast = useCallback(() => setToast(null), []);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [bulkReport, setBulkReport] = useState(null);
  const bulkSamplesRef = useRef(new Map()); // checked samples beyond the loaded pages
  const fileInputRef = useRef(null);

  const byId = useMemo(() => new Map(samples.map((s) => [s.id, s])), [samples]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const selected = selectedId ? byId.get(selectedId) || null : null;
  const docked = wide && inspectorOpen && !phone;

  const setBusy = (id, delta) =>
    setBusyIds((prev) => {
      const n = (prev[id] || 0) + delta;
      const next = { ...prev };
      if (n > 0) next[id] = n;
      else delete next[id];
      return next;
    });
  const setRowError = (id, error) =>
    setRowErrors((prev) => {
      const next = { ...prev };
      if (error) next[id] = error;
      else delete next[id];
      return next;
    });

  // Switching Sync (or the project tempo) re-starts what's playing at the new tempo.
  const lastSyncRef = useRef(syncBpm);
  useEffect(() => {
    if (lastSyncRef.current === syncBpm) return;
    lastSyncRef.current = syncBpm;
    const s = playingId && byIdRef.current.get(playingId);
    if (s) preview.play(s);
  }, [syncBpm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop if the playing sample leaves the list (deleted / filtered out).
  useEffect(() => {
    if (playingId && list.loaded && !list.stale && !byId.has(playingId)) preview.stop();
  }, [playingId, byId, list.loaded, list.stale]); // eslint-disable-line react-hooks/exhaustive-deps

  // Crossing 1280 px (iPad rotation, Split View, a resize) docks or undocks
  // the inspector: one inspector at a time - the dock replaces an open
  // inspector sheet, and a sheet takes over from the dock if you were in it
  // (its fields save what was typed as they unmount). A ⋯ menu anchored to
  // a row that just changed layout goes.
  const dockFocusRef = useRef(false);
  const wasDockedRef = useRef(docked);
  useEffect(() => {
    if (wasDockedRef.current === docked) return;
    wasDockedRef.current = docked;
    if (docked) setSheet((s) => (s?.type === 'inspector' ? null : s));
    else if (!wide && dockFocusRef.current && selectedId) setSheet({ type: 'inspector', id: selectedId }); // not on Hide
    dockFocusRef.current = false;
  }, [docked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => setMenu(null), [size]);

  // --- import (P6) ----------------------------------------------------------
  const queue = useImportQueue({
    onImported: (sample) => list.add(sample, { visible: filters.sort === 'newest' && !filtered }),
    onPatched: (sample) => list.replace(sample),
    onDrained: () => {
      list.refresh();
      fetchTags();
    },
  });
  const dragging = useFileDrop(queue.addFiles);

  // --- handlers (stable via ctx so memoized rows don't re-render) ----------
  const focusRow = (id) => {
    const el = document.querySelector(`[data-library-list] [data-id="${CSS.escape(id)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      // 'nearest' alone leaves a row under the sticky bars where it is:
      // Chromium tests it against the root's 56 px scroll-padding, not its
      // scroll-margin. A covered row aligns to the top (scroll-margin) instead.
      const head = document.querySelector('[data-library-list] > [role=row]');
      const top = head ? head.getBoundingClientRect().bottom : HEADER_PX + PHONE_BAR_PX;
      el.scrollIntoView({ block: el.getBoundingClientRect().top < top ? 'start' : 'nearest' });
    }
  };

  const select = (id, { play = false, focus = false } = {}) => {
    setSelectedId(id);
    if (confirmingId && confirmingId !== id) setConfirmingId(null);
    if (renamingId && renamingId !== id) setRenamingId(null);
    if (focus) requestAnimationFrame(() => focusRow(id));
    const sample = byId.get(id);
    if (play && sample && playingId !== id) preview.play(sample);
  };

  const toggleCheck = (id, shift) => {
    const anchor = anchorRef.current; // read now: the updater runs after the ref moves on
    setChecked((prev) => {
      const next = new Set(prev);
      if (shift && anchor && anchor !== id) {
        const ids = samples.map((s) => s.id);
        const a = ids.indexOf(anchor);
        const b = ids.indexOf(id);
        if (a >= 0 && b >= 0) {
          const on = !prev.has(id) || prev.has(anchor);
          ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => (on ? next.add(x) : next.delete(x)));
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchorRef.current = id;
  };

  const patch = async (id, changes) => {
    setBusy(id, 1);
    try {
      const res = await updateSample(id, changes);
      list.replace(res.data);
      setRowError(id, null);
      if ('tags' in changes) fetchTags();
    } catch (err) {
      setRowError(id, { message: errorMessage(err, 'Could not save the change') });
    } finally {
      setBusy(id, -1);
    }
  };

  const analyze = async (id) => {
    setBusy(id, 1);
    try {
      const res = await analyzeSample(id);
      list.replace(res.data);
      setRowError(id, null);
    } catch (err) {
      setRowError(id, { message: errorMessage(err, 'Could not start analysis') });
    } finally {
      setBusy(id, -1);
    }
  };

  const remove = async (id) => {
    setBusy(id, 1);
    try {
      await deleteSample(id);
      if (playingId === id) preview.stop();
      list.remove([id]);
      setRowError(id, null);
      setChecked((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedId === id) {
        const i = samples.findIndex((s) => s.id === id);
        const neighbour = samples[i + 1] || samples[i - 1];
        setSelectedId(neighbour?.id || null);
      }
      fetchTags();
    } catch (err) {
      const projects = err?.response?.status === 409 ? err.response.data?.projects : null;
      setRowError(id, projects?.length ? { projects } : { message: errorMessage(err, 'Could not delete the sample') });
    } finally {
      setBusy(id, -1);
      setConfirmingId((c) => (c === id ? null : c));
    }
  };

  const addToArrange = async (sample) => {
    setBusy(sample.id, 1);
    try {
      const { project: p, bar, created } = await addSample(sample);
      setToast({
        message: `Added “${sample.name}” to ${p.name}${created ? ' (new project)' : ''} at bar ${bar}`,
        href: href(`/arrange/${p.id}`),
        linkLabel: 'Open',
      });
    } catch (err) {
      setRowError(sample.id, { message: errorMessage(err, 'Could not add it to the project') });
    } finally {
      setBusy(sample.id, -1);
    }
  };

  // One WAV under its BPM/key name, saved by the browser itself (its own
  // download progress; a double tap doesn't save it twice).
  const download = (e, sample) => downloadAsNamed(e, sampleAudioUrl(sample), downloadName(sample));

  const handlers = {
    rowClick(sample, e) {
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        toggleCheck(sample.id, e.shiftKey);
        return;
      }
      select(sample.id, { play: auto });
    },
    rowDoubleClick(sample) {
      if (docked) setRenamingId(sample.id);
      else if (wide) setInspectorOpen(true);
      else setSheet({ type: 'inspector', id: sample.id });
    },
    rowFocus(sample) {
      if (selectedId !== sample.id) setSelectedId(sample.id);
    },
    cardTap(sample) {
      setSelectedId(sample.id);
      // "Auto-play on tap" (filter sheet); off = tap only selects, ▶ plays
      if (auto) preview.toggle(sample);
    },
    togglePlay(sample) {
      setSelectedId(sample.id);
      preview.toggle(sample);
    },
    seek(sample, ratio) {
      setSelectedId(sample.id);
      if (playingId !== sample.id || !preview.seek(ratio)) preview.play(sample, { at: ratio });
    },
    toggleCheck,
    openMenu(sample, button) {
      setSelectedId(sample.id);
      // the same ⋯ again closes it
      setMenu((m) => (m?.id === sample.id ? null : { id: sample.id, anchor: button }));
    },
    openActions(sample) {
      setSelectedId(sample.id);
      setSheet({ type: 'actions', id: sample.id });
    },
    setRenaming: setRenamingId,
    setConfirming: setConfirmingId,
    patch,
    analyze,
    remove,
    dismissError: (id) => setRowError(id, null),
    addToArrange,
    download,
  };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const ctx = useMemo(
    () => Object.fromEntries(CTX_KEYS.map((k) => [k, (...args) => handlersRef.current[k](...args)])),
    []
  );

  // --- keyboard (P1): ↑/↓ select, Space play, Enter rename, Del delete, L loop
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented || e.altKey) return;
      const t = e.target;
      // Arrows mean nothing to a focused ▶/⋯ button, so they keep moving
      // the selection after a click on one; Space/Enter/Del belong to it.
      const nav = e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End';
      const own = nav ? 'input, textarea, select, [contenteditable="true"]' : 'input, textarea, select, button, a, label, [contenteditable="true"]';
      if (t instanceof Element && t.closest(own)) return;
      if (document.querySelector('[data-library-overlay]')) return;
      handlersRef.current.key?.(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  handlers.key = (e) => {
    const mod = e.metaKey || e.ctrlKey;
    const idx = samples.findIndex((s) => s.id === selectedId);
    const current = idx >= 0 ? samples[idx] : null;
    const go = (i) => {
      const s = samples[Math.max(0, Math.min(samples.length - 1, i))];
      if (!s) return;
      select(s.id, { play: auto, focus: true });
      if (list.hasMore && i > samples.length - 10) list.loadMore();
    };
    // letters by physical key too: with a Hangul layout L arrives as 'ㅣ'
    switch (e.key.length === 1 ? shortcutKey(e) : e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (mod) return;
        e.preventDefault();
        go(idx < 0 ? 0 : idx + (e.key === 'ArrowDown' ? 1 : -1));
        break;
      case 'Home':
      case 'End':
        e.preventDefault();
        go(e.key === 'Home' ? 0 : samples.length - 1);
        break;
      case ' ':
        if (!current) return;
        e.preventDefault();
        preview.toggle(current);
        break;
      case 'Enter':
        if (!current || phone) return;
        e.preventDefault();
        setRenamingId(current.id);
        break;
      case 'Delete':
      case 'Backspace':
        if (!current) return;
        e.preventDefault();
        if (phone) setSheet({ type: 'confirm', id: current.id });
        else setConfirmingId(current.id);
        break;
      case 'l':
        if (mod) return;
        setLoop((v) => !v);
        break;
      case 'a':
        if (!mod) return;
        e.preventDefault();
        setChecked(new Set(samples.map((s) => s.id)));
        break;
      case 'Escape':
        if (confirmingId) setConfirmingId(null);
        else if (checked.size) setChecked(new Set());
        else if (playingId) preview.stop();
        break;
      default:
    }
  };

  // --- scroll restore + view memory (B10) ----------------------------------
  const restoredRef = useRef(!saved);
  useLayoutEffect(() => {
    if (restoredRef.current || !list.loaded || list.stale) return;
    const want = Math.min(saved.count, list.matched ?? saved.count);
    if (samples.length < want && list.hasMore) return; // still loading the pages
    restoredRef.current = true;
    window.scrollTo(0, saved.y);
  }, [list.loaded, list.stale, samples.length, list.matched, list.hasMore, saved]);

  const viewRef = useRef(null);
  viewRef.current = { qs, count: samples.length, selectedId };
  const rootRef = useRef(null);
  // Layout effect: its cleanup runs before React removes our DOM, while
  // scrollY still belongs to the list (a passive cleanup would read the
  // next screen's clamped 0).
  useLayoutEffect(() => {
    let frame = 0;
    const save = () => {
      frame = 0;
      // the scroll that shrinking the page causes on the way out isn't ours
      if (!restoredRef.current || !rootRef.current?.isConnected) return;
      writeView({ ...viewRef.current, y: window.scrollY });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(save);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
      save();
    };
  }, []);
  useEffect(() => {
    if (restoredRef.current) writeView({ ...viewRef.current, y: window.scrollY });
  }, [qs, samples.length, selectedId]);

  // New filters start at the top of the results.
  const firstQs = useRef(qs);
  useEffect(() => {
    if (qs !== firstQs.current) {
      firstQs.current = qs;
      window.scrollTo(0, 0);
    }
  }, [qs]);

  // Infinite scroll: a sentinel after the last row.
  const sentinelRef = useRef(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !list.hasMore) return undefined;
    const obs = new IntersectionObserver((entries) => entries[0].isIntersecting && list.loadMore(), { rootMargin: '800px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [list.hasMore, list.loadMore, samples.length]);

  // --- bulk (P5) ------------------------------------------------------------
  const checkedIds = [...checked];
  const checkedSample = (id) => byId.get(id) || bulkSamplesRef.current.get(id);
  const allMatchedChecked = list.matched != null && checked.size >= list.matched;

  const selectAllMatched = async () => {
    if (list.matched != null && list.matched <= samples.length) {
      setChecked(new Set(samples.map((s) => s.id)));
      return;
    }
    setBulkBusy(true);
    try {
      const res = await listSamples({ ...filters, limit: 0 });
      const rows = res.data?.samples || [];
      bulkSamplesRef.current = new Map(rows.map((s) => [s.id, s]));
      setChecked(new Set(rows.map((s) => s.id)));
    } catch (err) {
      setBanner(errorMessage(err, 'Could not select every match'));
    } finally {
      setBulkBusy(false);
    }
  };

  // Tag batches queue: the tag field stays usable while one runs, and two
  // batches over the same samples at once would each drop the other's tags.
  // Each batch reads what the previous one wrote (`written`), since the
  // list may not have re-rendered in between.
  const tagQueueRef = useRef({ tail: Promise.resolve(), count: 0, written: new Map() });
  const runBulkTagRef = useRef(null);
  const bulkTag = (change) => {
    const q = tagQueueRef.current;
    q.count += 1;
    q.tail = q.tail
      .then(() => runBulkTagRef.current(change))
      .finally(() => {
        q.count -= 1;
        if (!q.count) q.written.clear();
      });
  };

  runBulkTagRef.current = async ({ add = [], remove: drop = [] }) => {
    const { written } = tagQueueRef.current;
    setBulkBusy(true);
    let done = 0;
    const ids = checkedIds;
    const failed = [];
    const updated = await pool(ids, 4, async (id) => {
      const s = written.get(id) || checkedSample(id);
      const cur = s?.tags || [];
      const next = [...new Set([...cur.filter((t) => !drop.includes(t)), ...add])];
      if (s && next.length === cur.length && next.every((t, i) => t === cur[i])) {
        done += 1;
        return null;
      }
      try {
        const res = await updateSample(id, { tags: next });
        bulkSamplesRef.current.set(id, res.data);
        written.set(id, res.data);
        return res.data;
      } catch (err) {
        failed.push(s?.name || id);
        return null;
      } finally {
        done += 1;
        setBulkProgress(`Tagging ${done} of ${ids.length}`);
      }
    });
    list.replaceMany(updated.filter(Boolean));
    fetchTags();
    setBulkProgress(null);
    setBulkBusy(false);
    if (failed.length) setBulkReport({ title: `Couldn't tag ${plural(failed.length, 'sample')}`, lines: failed.map((n) => ({ name: n })) });
  };

  const bulkReanalyze = async (ids) => {
    setBulkBusy(true);
    try {
      const res = await analyzeSamples(ids);
      const queued = res.data?.queued ?? ids.length;
      const mark = ids.length ? new Set(ids) : null;
      list.replaceMany(samples.filter((s) => !mark || mark.has(s.id)).map((s) => ({ ...s, analysis_status: 'pending' })));
      setToast({ message: `Re-analyzing ${plural(queued, 'sample')} — your BPM/key overrides are kept` });
    } catch (err) {
      setBanner(errorMessage(err, 'Could not start re-analysis'));
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkZip = async () => {
    setBulkBusy(true);
    setBulkProgress(`Zipping ${plural(checked.size, 'sample')}…`);
    try {
      const blob = await exportSamples(checkedIds);
      saveBlob(blob, `samples-${checked.size}.zip`);
    } catch (err) {
      setBanner(errorMessage(err, 'Could not build the ZIP'));
    } finally {
      setBulkProgress(null);
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    setBulkBusy(true);
    const ids = checkedIds;
    const gone = [];
    const conflicts = [];
    let done = 0;
    await pool(ids, 4, async (id) => {
      const s = checkedSample(id);
      try {
        await deleteSample(id);
        gone.push(id);
      } catch (err) {
        const projects = err?.response?.status === 409 ? err.response.data?.projects : null;
        conflicts.push({ id, name: s?.name || id, projects, message: projects ? null : errorMessage(err, 'Could not delete') });
      } finally {
        done += 1;
        setBulkProgress(`Deleting ${done} of ${ids.length}`);
      }
    });
    if (gone.includes(playingId)) preview.stop();
    list.remove(gone);
    gone.forEach((id) => bulkSamplesRef.current.delete(id));
    setChecked(new Set(conflicts.map((c) => c.id)));
    if (gone.includes(selectedId)) setSelectedId(null);
    fetchTags();
    setBulkProgress(null);
    setBulkBusy(false);
    // One combined report instead of a toast per refusal.
    setBulkReport(
      conflicts.length
        ? {
            title: `Deleted ${gone.length} of ${ids.length}. ${plural(conflicts.length, 'sample is', 'samples are')} still in use or failed (kept selected):`,
            lines: conflicts,
          }
        : null
    );
    if (!conflicts.length) setToast({ message: `Deleted ${plural(gone.length, 'sample')}` });
  };

  const tagPresent = useMemo(() => {
    const set = new Set();
    for (const id of checked) (checkedSample(id)?.tags || []).forEach((t) => set.add(t));
    return [...set].sort();
  }, [checked, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  const tagPanel = (
    <BulkTagPanel count={checked.size} present={tagPresent} allTags={allTags} onApply={bulkTag} />
  );

  // --- per-sample action list (⋯ menu / phone action sheet) ---------------
  // Keyboard hints only where there's likely a keyboard (`keys`).
  const keyHint = (hint) => (keys ? hint : undefined);
  const actionsFor = (sample, { sheetMode }) => {
    const playing = playingId === sample.id;
    const taskId = sample.source?.task_id;
    return [
      { key: 'play', label: playing ? 'Stop' : 'Play', onSelect: () => preview.toggle(sample) },
      ...(!docked ? [{ key: 'edit', label: 'Edit details…', hint: 'BPM, key, tags', onSelect: () => (wide ? setInspectorOpen(true) : setSheet({ type: 'inspector', id: sample.id })) }] : []),
      ...(!phone ? [{ key: 'rename', label: 'Rename', hint: keyHint('Enter'), onSelect: () => setRenamingId(sample.id) }] : []),
      { key: 'arrange', label: 'Add to Arrange', hint: project ? project.name : 'new project', onSelect: () => addToArrange(sample) },
      ...(taskId ? [{ key: 'split', label: 'Open in Split', href: href(`/split/job/${taskId}`) }] : []),
      {
        key: 'download',
        label: 'Download WAV',
        hint: downloadName(sample),
        href: sampleAudioUrl(sample),
        download: downloadName(sample),
        onClick: (e) => download(e, sample),
      },
      { key: 'analyze', label: 'Re-analyze', hint: 'keeps your BPM/key', onSelect: () => analyze(sample.id), disabled: sample.analysis_status === 'pending' },
      { key: 'check', label: checked.has(sample.id) ? 'Unselect' : 'Select', hint: phone ? 'or long-press' : keyHint('Shift-click for a range'), onSelect: () => toggleCheck(sample.id, false) },
      {
        key: 'delete',
        label: 'Delete…',
        hint: phone ? undefined : keyHint('Del'),
        onSelect: () => (sheetMode ? setSheet({ type: 'confirm', id: sample.id }) : setConfirmingId(sample.id)),
      },
    ];
  };

  const moreItems = [
    { key: 'reanalyze', label: 'Re-analyze all', hint: 'keeps overrides', onSelect: () => bulkReanalyze([]) },
    { key: 'camelot', label: camelot ? 'Key names: Camelot' : 'Key names: plain', hint: camelot ? '8B · C maj' : 'C maj', onSelect: () => setCamelot(!camelot) },
    ...(!wide
      ? [
          { key: 'auto', label: `Auto-play on select: ${auto ? 'on' : 'off'}`, onSelect: () => setAuto(!auto) },
          { key: 'loop', label: `Loop: ${loop ? 'on' : 'off'}`, hint: keyHint('L'), onSelect: () => setLoop(!loop) },
        ]
      : []),
    ...(wide ? [{ key: 'inspector', label: inspectorOpen ? 'Hide inspector' : 'Show inspector', onSelect: () => setInspectorOpen(!inspectorOpen) }] : []),
    ...(list.matched ? [{ key: 'all', label: `Select all ${list.matched}`, hint: keyHint(`${MOD}+A: loaded`), onSelect: selectAllMatched }] : []),
  ];

  const audition = { auto, setAuto, loop, setLoop, sync, setSync, manualBpm, setManualBpm: (v) => setManualBpm(v) };
  const counts = { matched: list.matched, total: list.total, loaded: list.loaded };
  const checkState = checked.size === 0 ? 'none' : samples.every((s) => checked.has(s.id)) ? 'all' : 'some';
  const playingSample = playingId ? byId.get(playingId) : null;
  const phoneSelecting = phone && (selectMode || checked.size > 0);
  const bottomBar = phone && (phoneSelecting || playingSample);
  const stickyTop = HEADER_PX + (phone ? PHONE_BAR_PX : TOOLBAR_PX);

  // --- render -------------------------------------------------------------
  const toolbar = (
    <div
      className="bleed-safe sticky z-20 border-b border-line bg-paper"
      style={{ top: HEADER_PX }}
    >
      {phone ? (
        <PhoneBar
          filters={filters}
          onFilters={onFilters}
          activeCount={activeCount}
          counts={counts}
          onOpenFilters={() => setSheet({ type: 'filters' })}
          onImport={() => fileInputRef.current?.click()}
          onSelect={() => setSelectMode(true)}
        />
      ) : checked.size > 0 ? (
        <BulkBar
          count={checked.size}
          matched={list.matched ?? samples.length}
          allMatched={allMatchedChecked}
          onSelectAllMatched={selectAllMatched}
          onClear={() => setChecked(new Set())}
          onReanalyze={() => bulkReanalyze(checkedIds)}
          onZip={bulkZip}
          onDelete={bulkDelete}
          tagPanel={tagPanel}
          busy={bulkBusy}
          progress={bulkProgress}
        />
      ) : (
        <DesktopToolbar
          size={size}
          wide={wide}
          filters={filters}
          onFilters={onFilters}
          tags={allTags}
          counts={counts}
          filtered={filtered}
          activeCount={activeCount}
          onClear={onClear}
          camelot={camelot}
          audition={audition}
          project={project}
          onImport={() => fileInputRef.current?.click()}
          moreItems={moreItems}
          onOpenFilters={() => setSheet({ type: 'filters' })}
        />
      )}
    </div>
  );

  let body;
  if (!list.loaded) {
    body = (
      <div className="flex justify-center py-10 text-muted">
        {list.error ? (
          <TextButton onClick={() => list.refresh()} className={COARSE}>
            Retry
          </TextButton>
        ) : (
          <p className="m-0">Loading…</p>
        )}
      </div>
    );
  } else if (!samples.length) {
    body = (
      <div className="flex flex-col items-center gap-3 py-12 text-center">
        {filtered ? (
          <>
            <p className="m-0 text-muted">No samples match these filters.</p>
            <TextButton onClick={onClear} className={COARSE}>
              Clear filters
            </TextButton>
          </>
        ) : (
          <>
            <p className="m-0 text-muted">No samples yet.</p>
            <p className="m-0 max-w-measure">
              Select a region on a stem in the Split screen to extract it here, or drop audio files anywhere on this page.
            </p>
            <TextButton onClick={() => fileInputRef.current?.click()} className={COARSE}>
              Import files
            </TextButton>
          </>
        )}
      </div>
    );
  } else {
    const rowSize = size === 'tablet' ? 'tablet' : 'desktop';
    body = (
      <div
        role="grid"
        aria-label="Samples"
        aria-rowcount={list.matched ?? samples.length}
        aria-multiselectable="true"
        aria-busy={list.stale || undefined}
        data-library-list
        className={phone ? '' : 'min-w-0'}
      >
        {!phone && (
          <TableHeader
            size={rowSize}
            sort={filters.sort}
            onSort={(s) => onFilters({ sort: s })}
            checkState={checkState}
            onCheckAll={() => setChecked(checkState === 'all' ? new Set() : new Set(samples.map((s) => s.id)))}
            top={stickyTop}
          />
        )}
        {/* scroll-margin keeps keyboard-selected rows clear of the sticky bars */}
        <div role="rowgroup" className="[&>[role=row]]:scroll-mt-[132px] [&>[role=row]]:scroll-mb-16">
          {samples.map((s) =>
            phone ? (
              <SampleCard
                key={s.id}
                sample={s}
                selected={s.id === selectedId}
                checked={checked.has(s.id)}
                selecting={selectMode || checked.size > 0}
                playing={s.id === playingId}
                loading={s.id === loadingId}
                error={rowErrors[s.id]}
                busy={!!busyIds[s.id]}
                camelot={camelot}
                audioRef={audioRef}
                ctx={ctx}
              />
            ) : (
              <SampleRow
                key={s.id}
                sample={s}
                size={rowSize}
                selected={s.id === selectedId}
                checked={checked.has(s.id)}
                playing={s.id === playingId}
                loading={s.id === loadingId}
                renaming={s.id === renamingId}
                confirming={s.id === confirmingId}
                error={rowErrors[s.id]}
                busy={!!busyIds[s.id]}
                camelot={camelot}
                audioRef={audioRef}
                ctx={ctx}
              />
            )
          )}
        </div>
        <div ref={sentinelRef} className="flex min-h-10 items-center justify-center text-caption text-muted">
          {list.hasMore ? (
            <TextButton onClick={list.loadMore} disabled={list.loadingMore} className={COARSE}>
              {list.loadingMore ? 'Loading…' : `Load more (${list.matched - samples.length} left)`}
            </TextButton>
          ) : samples.length > 30 ? (
            <span>{plural(samples.length, 'sample')}</span>
          ) : null}
        </div>
      </div>
    );
  }

  const menuSample = menu ? byId.get(menu.id) : null;
  const sheetSample = sheet?.id ? byId.get(sheet.id) : null;

  return (
    <div ref={rootRef} className={`flex w-full flex-col ${bottomBar ? 'pb-16' : ''}`}>
      {toolbar}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,video/*,.wav,.mp3,.flac,.ogg,.oga,.opus,.m4a,.aac,.aiff,.aif,.wma,.webm"
        onChange={(e) => {
          queue.addFiles(e.target.files);
          e.target.value = ''; // allow re-picking the same files
        }}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
      />

      {phone && filtered && list.loaded && (
        <div className="flex h-8 items-center gap-3 border-b border-line text-caption">
          <span className="tabular-nums">
            {list.matched} of {list.total}
          </span>
          <TextButton onClick={onClear} className={COARSE}>
            Clear
          </TextButton>
        </div>
      )}

      {(banner || (list.error && list.loaded)) && (
        <div className="py-2">
          <ErrorBanner
            message={banner || list.error}
            onDismiss={() => {
              setBanner(null);
              list.setError(null);
            }}
          />
        </div>
      )}

      {bulkReport && (
        <div role="alert" className="flex flex-col gap-1 border-b border-line py-2">
          <div className="flex items-baseline gap-4">
            <p className="m-0">{bulkReport.title}</p>
            <TextButton muted onClick={() => setBulkReport(null)} className={`text-caption ${COARSE}`}>
              Dismiss
            </TextButton>
          </div>
          <ul className="m-0 list-none p-0">
            {bulkReport.lines.map((c) => (
              <li key={c.id || c.name} className="flex flex-wrap items-baseline gap-x-3">
                <span className="max-w-[20rem] truncate">{c.name}</span>
                {(c.projects || c.message) && <RowError error={c.projects ? { projects: c.projects } : { message: c.message }} />}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ImportPanel queue={queue} allTags={allTags} />

      {docked ? (
        <div className="flex items-start gap-6">
          <div className="min-w-0 flex-1">{body}</div>
          <aside
            aria-label="Inspector"
            className="sticky w-[360px] shrink-0 self-start overflow-y-auto overscroll-contain border-l border-line pl-6"
            style={{ top: stickyTop, maxHeight: `calc(100vh - ${stickyTop}px)` }}
            onFocus={() => (dockFocusRef.current = true)}
            onBlur={() => (dockFocusRef.current = false)}
          >
            <Inspector
              keys={keys}
              sample={selected}
              busy={selected ? !!busyIds[selected.id] : false}
              playing={!!selected && playingId === selected.id}
              loading={!!selected && loadingId === selected.id}
              audioRef={audioRef}
              camelot={camelot}
              allTags={allTags}
              error={selected ? rowErrors[selected.id] : null}
              confirming={!!selected && confirmingId === selected.id}
              project={project}
              ctx={ctx}
              onHide={() => setInspectorOpen(false)}
            />
          </aside>
        </div>
      ) : (
        body
      )}

      {menu && menuSample && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={300} label={`Actions for ${menuSample.name}`}>
          <ActionList items={actionsFor(menuSample, { sheetMode: false })} dense onDone={() => setMenu(null)} />
        </Popover>
      )}

      {sheet?.type === 'actions' && sheetSample && (
        <BottomSheet title={sheetSample.name} onClose={() => setSheet(null)}>
          <ActionList items={actionsFor(sheetSample, { sheetMode: true })} onDone={() => setSheet((s) => (s?.type === 'actions' ? null : s))} />
        </BottomSheet>
      )}

      {sheet?.type === 'confirm' && sheetSample && (
        <BottomSheet title={`Delete “${sheetSample.name}”?`} onClose={() => setSheet(null)}>
          <ActionList
            items={[
              { key: 'yes', label: 'Delete', hint: 'can’t be undone', onSelect: () => remove(sheetSample.id) },
              { key: 'no', label: 'Cancel', onSelect: () => {} },
            ]}
            onDone={() => setSheet(null)}
          />
        </BottomSheet>
      )}

      {sheet?.type === 'inspector' && sheetSample && (
        <BottomSheet title="Edit sample" label={`Edit ${sheetSample.name}`} onClose={() => setSheet(null)}>
          <div className="px-4 sm:px-6">
            <Inspector
              sample={sheetSample}
              busy={!!busyIds[sheetSample.id]}
              playing={playingId === sheetSample.id}
              loading={loadingId === sheetSample.id}
              audioRef={audioRef}
              camelot={camelot}
              allTags={allTags}
              error={rowErrors[sheetSample.id]}
              confirming={confirmingId === sheetSample.id}
              project={project}
              ctx={ctx}
            />
          </div>
        </BottomSheet>
      )}

      {sheet?.type === 'filters' && (
        <FilterSheet
          filters={filters}
          onFilters={onFilters}
          tags={allTags}
          camelot={camelot}
          setCamelot={setCamelot}
          audition={audition}
          project={project}
          filtered={filtered}
          counts={counts}
          onClear={onClear}
          onReanalyzeAll={() => {
            setSheet(null);
            bulkReanalyze([]);
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {phoneSelecting && (
        <BulkBar
          phone
          count={checked.size}
          matched={list.matched ?? samples.length}
          allMatched={allMatchedChecked}
          onSelectAllMatched={selectAllMatched}
          onClear={clearChecked}
          onReanalyze={() => bulkReanalyze(checkedIds)}
          onZip={bulkZip}
          onDelete={bulkDelete}
          tagPanel={tagPanel}
          busy={bulkBusy}
          progress={bulkProgress}
          playing={playingSample ? { sample: playingSample, loading: loadingId === playingSample.id, onStop: preview.stop } : null}
        />
      )}

      {phone && !phoneSelecting && playingSample && (
        <NowPlaying
          sample={playingSample}
          loading={loadingId === playingSample.id}
          audioRef={audioRef}
          onStop={preview.stop}
          onSeek={(r) => preview.seek(r)}
          loop={loop}
          onLoop={() => setLoop(!loop)}
          sync={sync}
          onSync={() => setSync(!sync)}
          syncLabel={syncBpm ? `Sync ${Math.round(syncBpm)}` : 'Sync'}
        />
      )}

      <Toast toast={toast} onClose={closeToast} raised={bottomBar} />
      {dragging && <DropVeil />}
    </div>
  );
}
