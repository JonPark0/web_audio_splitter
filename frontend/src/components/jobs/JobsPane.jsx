import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FiSearch, FiX } from 'react-icons/fi';
import { cancelTask, deleteTask, errorDetail, getTasks } from '../../api';
import { useDevice } from '../../device';
import { isComposing } from '../../keys';
import { setQuery, useRoute } from '../../router';
import usePoll from '../shell/usePoll';
import useElementWidth from '../shell/useElementWidth';
import TextButton from '../TextButton';
import WordToggle from '../WordToggle';
import JobRow, { JobsHeaderRow } from './JobRow';
import { IN_FLIGHT, STATUS_FILTERS, TERMINAL } from './format';
import {
  cacheJobsList,
  cachedJobsList,
  jobsChanged,
  onJobsChanged,
  publishFromTasks,
  registerJobsPane,
} from './jobsStore';

const PAGE = 30;
const FAST = 2500; // while anything is queued / running / cancelling
const SLOW = 20000;

// After a failed fetch: 2.5, 5, 10, then every 20 s — not straight to the
// idle 20 s, or a running job's list sat stale after one network blip.
const retryDelay = (failures) => Math.min(SLOW, FAST * 2 ** Math.min(3, failures - 1));

// Touch needs more room for the one-line tiers: its actions column is 40 px
// wider and, with no hover title, the name should still get two readable
// lines (an iPad in landscape left it ~50 px).
function tierFor(width, coarse) {
  const extra = coarse ? 120 : 0;
  if (width >= 780 + extra) return 'wide';
  if (width >= 560 + extra) return 'medium';
  return 'narrow';
}

// The server filters by q/status; filtering again here is a no-op on it and
// keeps the list right against an older server that ignores the params.
function clientFilter(tasks, q, statuses) {
  const needle = q.trim().toLowerCase();
  return (tasks || []).filter(
    (t) =>
      (!statuses || statuses.includes(t.status)) &&
      (!needle || String(t.name || '').toLowerCase().includes(needle))
  );
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((t) => (seen.has(t.task_id) ? false : seen.add(t.task_id)));
}

/**
 * The live jobs list of the Split home: search, status filter, Load more,
 * and per-row Open / Cancel / Retry / Delete. Polls fast while any job is in
 * flight, slowly otherwise, never while the tab is hidden.
 */
export default function JobsPane({ className = '', currentId = null }) {
  const route = useRoute();
  const filter = STATUS_FILTERS.some((f) => f.value === route.query.status) ? route.query.status : 'all';
  const statuses = STATUS_FILTERS.find((f) => f.value === filter).statuses;
  const statusParam = statuses ? statuses.join(',') : undefined;
  const q = route.query.q || '';
  const listKey = `${q}\n${statusParam || ''}`;
  const [cached] = useState(() => cachedJobsList(listKey));

  const rootRef = useRef(null);
  const toolbarRef = useRef(null);
  const width = useElementWidth(rootRef);
  const { coarse } = useDevice();
  const tier = tierFor(width || 0, coarse);
  const searchId = useId();

  const [qInput, setQInput] = useState(q);
  // On a narrow list the search field would take a whole 44 px row of the
  // phone's first screen; it opens from an icon instead (stays open while it
  // holds a query).
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const showSearch = tier !== 'narrow' || searchOpen || !!qInput;
  const [rows, setRows] = useState(cached?.rows ?? null); // null: first load
  const [hasMore, setHasMore] = useState(cached?.hasMore ?? false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [panel, setPanel] = useState(null); // { id, kind: 'cancel' | 'retry' | 'delete' | 'menu' }
  const [busy, setBusy] = useState(null); // { id, kind }
  const [cancelling, setCancelling] = useState(() => new Set());
  const [rowError, setRowError] = useState(null); // { id, message }
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());

  // How many rows the poll refetches: one page, plus whatever "Load more"
  // added (the server caps a page at 200).
  const limitRef = useRef(cached?.limit ?? PAGE);
  // The filter and length the shown rows were fetched for (for the cache).
  const fetchedRef = useRef(cached ? { key: listKey, limit: cached.limit } : null);
  const failuresRef = useRef(0);
  const focusAfterDelete = useRef(null); // task id or 'heading'
  const cancellingRef = useRef(cancelling);
  cancellingRef.current = cancelling;

  // Debounced search → URL (?q=), so refresh/back keep it.
  useEffect(() => {
    if (qInput === q) return undefined;
    const t = setTimeout(() => setQuery({ q: qInput.trim() || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qInput]);
  useEffect(() => setQInput((cur) => (cur.trim() === q ? cur : q)), [q]);

  // A new query starts from one page again (not the first render: that may
  // be a remount resuming a longer cached list).
  const keyRef = useRef(listKey);
  useEffect(() => {
    if (keyRef.current === listKey) return;
    keyRef.current = listKey;
    limitRef.current = PAGE;
    setPanel(null);
  }, [listKey]);

  useEffect(() => {
    if (rows && fetchedRef.current) cacheJobsList({ ...fetchedRef.current, rows, hasMore });
  }, [rows, hasMore]);

  useEffect(() => registerJobsPane(), []);

  const refresh = usePoll(
    async (ctx) => {
      const limit = Math.min(200, Math.max(PAGE, limitRef.current));
      try {
        const res = await getTasks({ limit, q: q || undefined, status: statusParam });
        if (ctx.stale()) return undefined;
        const inFlight = publishFromTasks(res.data);
        const list = clientFilter(res.data.tasks, q, statuses);
        fetchedRef.current = { key: listKey, limit };
        setRows((prev) => (prev && prev.length > 200 ? dedupe([...list, ...prev.slice(200)]) : list));
        setHasMore((res.data.tasks || []).length >= limit);
        setLoadError('');
        setNow(new Date());
        // Drop "cancelling" marks once the server reports the end.
        if (cancellingRef.current.size) {
          const ended = list.filter((t) => cancellingRef.current.has(t.task_id) && TERMINAL.has(t.status));
          if (ended.length) {
            setCancelling((s) => {
              const next = new Set(s);
              ended.forEach((t) => next.delete(t.task_id));
              return next;
            });
          }
        }
        failuresRef.current = 0;
        return { busy: inFlight > 0 || list.some((t) => IN_FLIGHT.has(t.status)) || cancellingRef.current.size > 0 };
      } catch (e) {
        if (ctx.stale()) return undefined;
        setLoadError(errorDetail(e, 'Could not load jobs.'));
        failuresRef.current += 1;
        return { failures: failuresRef.current };
      }
    },
    (r) => (r?.failures ? retryDelay(r.failures) : r?.busy ? FAST : SLOW),
    [q, statusParam]
  );

  useEffect(() => onJobsChanged(refresh), [refresh]);

  const loadMore = async () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const res = await getTasks({ limit: PAGE, before: last.created_at, q: q || undefined, status: statusParam });
      const more = clientFilter(res.data.tasks, q, statuses);
      limitRef.current += (res.data.tasks || []).length;
      fetchedRef.current = { key: listKey, limit: limitRef.current };
      setRows((prev) => dedupe([...(prev || []), ...more]));
      setHasMore((res.data.tasks || []).length >= PAGE);
    } catch (e) {
      setLoadError(errorDetail(e, 'Could not load more jobs.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const togglePanel = (id, kind) => {
    setRowError(null);
    setPanel((p) => (!kind || (p && p.id === id && p.kind === kind) ? null : { id, kind }));
  };

  const cancel = async (task) => {
    const id = task.task_id;
    setRowError(null);
    setBusy({ id, kind: 'cancel' });
    try {
      const res = await cancelTask(id);
      if (res.data?.status === 'cancelling') {
        setCancelling((s) => new Set(s).add(id));
      } else {
        setRows((rs) => rs?.map((t) => (t.task_id === id ? { ...t, status: 'cancelled', queue_position: null } : t)));
      }
      setPanel((p) => (p?.id === id ? null : p));
      jobsChanged();
    } catch (e) {
      setRowError({ id, message: errorDetail(e, 'Could not cancel this job.') });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (task) => {
    const id = task.task_id;
    setRowError(null);
    setBusy({ id, kind: 'delete' });
    try {
      await deleteTask(id);
      // The confirm strip goes with the row: focus moves on to the next row
      // (or the previous, or the heading) instead of falling to the page.
      const at = rows?.findIndex((t) => t.task_id === id) ?? -1;
      const neighbour = rows?.[at + 1] || rows?.[at - 1];
      focusAfterDelete.current = neighbour && at >= 0 ? neighbour.task_id : 'heading';
      setRows((rs) => rs?.filter((t) => t.task_id !== id));
      setPanel(null);
      jobsChanged();
    } catch (e) {
      const fallback = e.response?.status === 409 ? 'This job is still running — cancel it first.' : 'Could not delete this job.';
      setRowError({ id, message: errorDetail(e, fallback) });
    } finally {
      setBusy(null);
    }
  };

  const retryStarted = () => {
    setPanel(null);
    setNotice('Retry queued — it is at the top of the list.');
    jobsChanged();
  };

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    const target = focusAfterDelete.current;
    if (!target) return;
    focusAfterDelete.current = null;
    // only if focus was lost with the strip, not if it went somewhere since
    if (document.activeElement && document.activeElement !== document.body) return;
    const row = target !== 'heading' && rootRef.current?.querySelector(`[data-job-row="${CSS.escape(target)}"] a[href]`);
    if (row) row.focus();
    else {
      const heading = document.getElementById('jobs-heading');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus();
    }
  }, [rows]);

  // Keyboard focus moving through the rows must not land under the sticky
  // toolbar (its height varies: touch targets, a wrapped search field). Rows
  // carry it as scroll-margin, which places a row the browser scrolls to; but
  // a row the toolbar merely covers counts as on screen and isn't scrolled at
  // all, so that one is lifted out here. Keyboard only: moving a row under a
  // pressed mouse would turn the click into a click on something else.
  const liftFocused = (e) => {
    const el = e.target;
    try {
      if (!el.matches(':focus-visible')) return;
    } catch (err) {
      return; // no :focus-visible (old Safari): leave it to the browser
    }
    requestAnimationFrame(() => {
      const bar = toolbarRef.current?.getBoundingClientRect();
      const top = el.getBoundingClientRect().top;
      if (bar && top < bar.bottom) window.scrollBy(0, top - bar.bottom - 8);
    });
  };
  useLayoutEffect(() => {
    const bar = toolbarRef.current;
    const root = rootRef.current;
    if (!bar || !root) return undefined;
    const update = () => root.style.setProperty('--jobs-bar', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(update);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);

  // iOS raises the keyboard only for a focus() made inside the tap itself,
  // so the field is rendered synchronously and focused right away.
  const openSearch = () => {
    flushSync(() => setSearchOpen(true));
    searchRef.current?.focus();
  };
  const clearSearch = () => {
    flushSync(() => {
      setQInput('');
      setSearchOpen(true);
    });
    setQuery({ q: null });
    searchRef.current?.focus();
  };

  const filtered = !!q || filter !== 'all';

  return (
    <section ref={rootRef} aria-labelledby="jobs-heading" className={`min-w-0 [--acts:8.25rem] coarse:[--acts:10.75rem] ${className}`}>
      {/* toolbar sticks under the 48px header */}
      <div ref={toolbarRef} className="sticky top-12 z-20 border-b border-line bg-paper pb-1 pt-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-5">
          <h2 id="jobs-heading" className="m-0 text-h4 font-light">
            Jobs
          </h2>
          <WordToggle
            name="jobs-filter"
            aria-label="Show jobs"
            options={STATUS_FILTERS}
            value={filter}
            onChange={(v) => setQuery({ status: v === 'all' ? null : v })}
            className="text-caption sm:text-p"
          />
          {!showSearch && (
            <TextButton
              aria-label="Search jobs"
              aria-expanded="false"
              label=""
              onClick={openSearch}
              className="ml-auto h-11 w-11"
            >
              <FiSearch className="icon" strokeWidth={1.5} aria-hidden="true" />
            </TextButton>
          )}
          {showSearch && (
            // Search key on the phone keyboard; it searches now and puts the
            // keyboard away so the results can be seen.
            <form
              role="search"
              aria-label="Jobs"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery({ q: qInput.trim() || null });
                searchRef.current?.blur();
              }}
              className={`relative flex items-center ${tier === 'narrow' ? 'basis-full' : 'ml-auto w-56'}`}
            >
              <label htmlFor={searchId} className="sr-only">
                Search jobs
              </label>
              <input
                id={searchId}
                ref={searchRef}
                type="search"
                enterKeyHint="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onKeyDown={(e) => {
                  // the Enter that confirms an IME composition isn't a search
                  if (e.key === 'Enter' && isComposing(e)) e.preventDefault();
                }}
                onBlur={() => !qInput && setSearchOpen(false)}
                placeholder="Search jobs"
                autoComplete="off"
                className={`ainput !pb-1 ${qInput ? 'pr-8 coarse:pr-11' : ''}`}
              />
              {/* the native clear button is stripped with the rest of the
                  browser chrome (.ainput), so this stands in for it */}
              {qInput && (
                <span className="absolute inset-y-0 right-0 flex items-center">
                  <TextButton aria-label="Clear search" label="" onClick={clearSearch} className="h-7 w-7">
                    <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
                  </TextButton>
                </span>
              )}
            </form>
          )}
        </div>
        <JobsHeaderRow tier={tier} />
      </div>

      <div aria-live="polite" className="text-caption">
        {notice && <p className="m-0 py-1">{notice}</p>}
      </div>
      {loadError && (
        <p className="m-0 py-1 text-caption" role="alert">
          <span className="text-muted">Error — </span>
          {loadError}{' '}
          <TextButton onClick={refresh} className="text-caption">
            Try again
          </TextButton>
        </p>
      )}

      {rows === null ? (
        !loadError && <p className="m-0 py-3 text-caption text-muted">Loading jobs...</p>
      ) : rows.length === 0 ? (
        <p className="m-0 py-3 text-muted">
          {filtered ? 'No jobs match.' : 'No jobs yet. Add audio files to start one.'}
        </p>
      ) : (
        <ul
          onFocus={liftFocused}
          className="m-0 flex list-none flex-col divide-y divide-line p-0 [&_*]:scroll-mt-[calc(var(--jobs-bar,4rem)+0.5rem)]"
        >
          {rows.map((task) => {
            const id = task.task_id;
            return (
              <JobRow
                key={id}
                task={task}
                tier={tier}
                current={id === currentId}
                now={now}
                panel={panel?.id === id ? panel.kind : null}
                onTogglePanel={(kind) => togglePanel(id, kind)}
                onCancel={() => cancel(task)}
                onDelete={() => remove(task)}
                onRetryStarted={retryStarted}
                busy={busy?.id === id ? busy.kind : null}
                cancelling={cancelling.has(id) || (busy?.id === id && busy.kind === 'cancel')}
                error={rowError?.id === id ? rowError.message : ''}
              />
            );
          })}
        </ul>
      )}

      {hasMore && rows?.length > 0 && (
        <div className="border-t border-line py-2">
          <TextButton onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading...' : 'Load more'}
          </TextButton>
        </div>
      )}
    </section>
  );
}
