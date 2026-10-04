import React, { useEffect, useId, useRef, useState } from 'react';
import { FiCheckSquare, FiSearch } from 'react-icons/fi';
import { cancelTask, deleteTask, errorDetail, getTasks } from '../../api';
import { setQuery, useRoute } from '../../router';
import usePoll from '../shell/usePoll';
import useElementWidth from '../shell/useElementWidth';
import RetryPanel from '../RetryPanel';
import TextButton from '../TextButton';
import WordToggle from '../WordToggle';
import BulkJobsBar from './BulkJobsBar';
import JobRow, { JobsHeaderRow } from './JobRow';
import { CANCELLABLE, IN_FLIGHT, RETRYABLE, STATUS_FILTERS, TERMINAL, jobName } from './format';
import { jobsChanged, onJobsChanged, publishFromTasks, registerJobsPane } from './jobsStore';

const PAGE = 30;
const FAST = 2500; // while anything is queued / running / cancelling
const SLOW = 20000;

function tierFor(width) {
  if (width >= 780) return 'wide';
  if (width >= 560) return 'medium';
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

  const rootRef = useRef(null);
  const width = useElementWidth(rootRef);
  const tier = tierFor(width || 0);
  const searchId = useId();

  const [qInput, setQInput] = useState(q);
  // On a narrow list the search field would take a whole 44 px row of the
  // phone's first screen; it opens from an icon instead (stays open while it
  // holds a query).
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);
  const showSearch = tier !== 'narrow' || searchOpen || !!qInput;
  const [rows, setRows] = useState(null); // null: first load
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [panel, setPanel] = useState(null); // { id, kind: 'retry' | 'delete' | 'menu' }
  const [busy, setBusy] = useState(null); // { id, kind }
  const [cancelling, setCancelling] = useState(() => new Set());
  const [rowError, setRowError] = useState(null); // { id, message }
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());

  // Bulk selection. Single-line rows always show their checkbox; the narrow
  // (phone) list shows them while selecting — started from the toolbar.
  const [checked, setChecked] = useState(() => new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [bulkPanel, setBulkPanel] = useState(null); // 'retry' | 'delete'
  const [bulkProgress, setBulkProgress] = useState('');
  const [bulkReport, setBulkReport] = useState('');
  const lastCheckedRef = useRef(null);
  const selecting = selectMode || checked.size > 0;

  // How many rows the poll refetches: one page, plus whatever "Load more"
  // added (the server caps a page at 200).
  const limitRef = useRef(PAGE);
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

  // A new query starts from one page again.
  useEffect(() => {
    limitRef.current = PAGE;
    setPanel(null);
  }, [q, statusParam]);

  useEffect(() => registerJobsPane(), []);

  const refresh = usePoll(
    async (ctx) => {
      const limit = Math.min(200, Math.max(PAGE, limitRef.current));
      try {
        const res = await getTasks({ limit, q: q || undefined, status: statusParam });
        if (ctx.stale()) return undefined;
        const inFlight = publishFromTasks(res.data);
        const list = clientFilter(res.data.tasks, q, statuses);
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
        return { busy: inFlight > 0 || list.some((t) => IN_FLIGHT.has(t.status)) || cancellingRef.current.size > 0 };
      } catch (e) {
        if (ctx.stale()) return undefined;
        setLoadError(errorDetail(e, 'Could not load jobs.'));
        return { busy: false };
      }
    },
    (r) => (r?.busy ? FAST : SLOW),
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
      setRows((prev) => dedupe([...(prev || []), ...more]));
      limitRef.current += (res.data.tasks || []).length;
      setHasMore((res.data.tasks || []).length >= PAGE);
    } catch (e) {
      setLoadError(errorDetail(e, 'Could not load more jobs.'));
    } finally {
      setLoadingMore(false);
    }
  };

  // Jobs that left the list (deleted, filtered out) leave the selection.
  useEffect(() => {
    if (!rows || !checked.size) return;
    const present = new Set(rows.map((t) => t.task_id));
    if ([...checked].some((id) => !present.has(id))) setChecked((c) => new Set([...c].filter((id) => present.has(id))));
  }, [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearSelection = () => {
    setChecked(new Set());
    setSelectMode(false);
    setBulkPanel(null);
    lastCheckedRef.current = null;
  };

  // Shift extends from the last box clicked, like a file manager.
  const toggleCheck = (id, shift) => {
    setBulkReport('');
    setChecked((prev) => {
      const next = new Set(prev);
      const ids = (rows || []).map((t) => t.task_id);
      const from = ids.indexOf(lastCheckedRef.current);
      const to = ids.indexOf(id);
      if (shift && from > -1 && to > -1) {
        const on = !prev.has(id);
        for (let i = Math.min(from, to); i <= Math.max(from, to); i++) (on ? next.add(ids[i]) : next.delete(ids[i]));
      } else if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastCheckedRef.current = id;
  };

  const allChecked = !!rows?.length && rows.every((t) => checked.has(t.task_id));
  const checkAll = () => {
    setBulkReport('');
    setChecked(allChecked ? new Set() : new Set((rows || []).map((t) => t.task_id)));
  };

  const checkedTasks = (rows || []).filter((t) => checked.has(t.task_id));
  const canCancel = checkedTasks.filter((t) => CANCELLABLE.has(t.status) && !cancelling.has(t.task_id));
  const canRetry = checkedTasks.filter((t) => RETRYABLE.has(t.status));
  const canDelete = checkedTasks.filter((t) => !IN_FLIGHT.has(t.status) && !cancelling.has(t.task_id));

  const report = (done, failures, extra = '') => {
    const lines = [done, extra, ...failures.slice(0, 3), failures.length > 3 ? `…and ${failures.length - 3} more failed.` : '']
      .filter(Boolean)
      .join(' ');
    setBulkReport(lines);
  };

  const bulkCancel = async () => {
    const targets = canCancel;
    const failures = [];
    let n = 0;
    for (const [i, t] of targets.entries()) {
      setBulkProgress(`Cancelling ${i + 1}/${targets.length}...`);
      try {
        const res = await cancelTask(t.task_id);
        if (res.data?.status === 'cancelling') setCancelling((c) => new Set(c).add(t.task_id));
        else setRows((rs) => rs?.map((r) => (r.task_id === t.task_id ? { ...r, status: 'cancelled', queue_position: null } : r)));
        n += 1;
      } catch (e) {
        failures.push(`${jobName(t)}: ${errorDetail(e, 'could not cancel')}.`);
      }
    }
    setBulkProgress('');
    report(`Cancelled ${n} ${n === 1 ? 'job' : 'jobs'}.`, failures);
    jobsChanged();
  };

  const bulkDelete = async () => {
    const targets = canDelete;
    const skipped = checkedTasks.length - targets.length;
    const failures = [];
    const gone = new Set();
    for (const [i, t] of targets.entries()) {
      setBulkProgress(`Deleting ${i + 1}/${targets.length}...`);
      try {
        await deleteTask(t.task_id);
        gone.add(t.task_id);
      } catch (e) {
        failures.push(`${jobName(t)}: ${errorDetail(e, 'could not delete')}.`);
      }
    }
    setBulkProgress('');
    setBulkPanel(null);
    setRows((rs) => rs?.filter((t) => !gone.has(t.task_id)));
    setChecked((c) => new Set([...c].filter((id) => !gone.has(id))));
    report(
      `Deleted ${gone.size} ${gone.size === 1 ? 'job' : 'jobs'}.`,
      failures,
      skipped ? `${skipped} still running ${skipped === 1 ? 'was' : 'were'} skipped — cancel ${skipped === 1 ? 'it' : 'them'} first.` : ''
    );
    jobsChanged();
  };

  const bulkRetryStarted = ({ started, failed }) => {
    clearSelection();
    report(`Queued ${started.length} ${started.length === 1 ? 'retry' : 'retries'} — at the top of the list.`, failed);
    jobsChanged();
  };

  useEffect(() => {
    if (!selecting) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !bulkProgress && !e.target.closest?.('input, select, textarea')) clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting, bulkProgress]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const filtered = !!q || filter !== 'all';

  return (
    <section ref={rootRef} aria-labelledby="jobs-heading" className={`min-w-0 [--acts:8.25rem] [--chk:1.25rem] [@media(pointer:coarse)]:[--acts:10.75rem] [@media(pointer:coarse)]:[--chk:2.75rem] ${className}`}>
      {/* toolbar sticks under the 48px header */}
      <div className="sticky top-12 z-20 border-b border-line bg-paper pb-1 pt-2">
        {/* always present for the section's label; the visible word is the
            span below (dropped on a narrow list to fit the toolbar row) */}
        <h2 id="jobs-heading" className="sr-only">
          Jobs
        </h2>
        {selecting ? (
          <BulkJobsBar
            narrow={tier === 'narrow'}
            count={checked.size}
            total={rows?.length || 0}
            eligible={{ cancel: canCancel.length, retry: canRetry.length, delete: canDelete.length }}
            panel={bulkPanel}
            progress={bulkProgress}
            onSelectAll={() => setChecked(new Set((rows || []).map((t) => t.task_id)))}
            onClear={clearSelection}
            onCancel={bulkCancel}
            onTogglePanel={(k) => setBulkPanel((cur) => (cur === k ? null : k))}
          />
        ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:gap-x-5">
          {tier !== 'narrow' && (
            <span aria-hidden="true" className="text-h4 font-light">
              Jobs
            </span>
          )}
          <WordToggle
            name="jobs-filter"
            aria-label="Show jobs"
            options={STATUS_FILTERS}
            value={filter}
            onChange={(v) => setQuery({ status: v === 'all' ? null : v })}
            className="text-caption sm:text-p"
          />
          {tier === 'narrow' && (
            <div className="ml-auto flex">
              <TextButton
                aria-label="Select jobs"
                label=""
                disabled={!rows?.length}
                onClick={() => setSelectMode(true)}
                className="h-11 w-11"
              >
                <FiCheckSquare className="icon" strokeWidth={1.5} aria-hidden="true" />
              </TextButton>
              {!showSearch && (
                <TextButton
                  aria-label="Search jobs"
                  aria-expanded="false"
                  label=""
                  onClick={() => {
                    setSearchOpen(true);
                    requestAnimationFrame(() => searchRef.current?.focus());
                  }}
                  className="h-11 w-11"
                >
                  <FiSearch className="icon" strokeWidth={1.5} aria-hidden="true" />
                </TextButton>
              )}
            </div>
          )}
          {showSearch && (
            <div className={`flex items-center ${tier === 'narrow' ? 'basis-full' : 'ml-auto w-56'}`}>
              <label htmlFor={searchId} className="sr-only">
                Search jobs
              </label>
              <input
                id={searchId}
                ref={searchRef}
                type="search"
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                onBlur={() => !qInput && setSearchOpen(false)}
                placeholder="Search jobs"
                autoComplete="off"
                className="ainput !pb-1"
              />
            </div>
          )}
        </div>
        )}
        <JobsHeaderRow tier={tier} allChecked={allChecked} someChecked={checked.size > 0} onCheckAll={checkAll} />
      </div>

      {bulkPanel === 'retry' && canRetry.length > 0 && (
        <RetryPanel
          className="border-b border-line py-2"
          taskIds={canRetry.map((t) => t.task_id)}
          initialModel={canRetry[0].model}
          initialRecover={canRetry[0].recover}
          initialRecoveryModel={canRetry[0].recovery_model}
          onStarted={bulkRetryStarted}
          onCancel={() => setBulkPanel(null)}
        />
      )}
      {bulkPanel === 'delete' && canDelete.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line py-2" role="group" aria-label="Confirm bulk delete">
          <span className="text-caption">
            {`Delete ${canDelete.length} ${canDelete.length === 1 ? 'job' : 'jobs'} and their stems? Library samples cut from them are kept.`}
            {canDelete.length < checkedTasks.length && ` ${checkedTasks.length - canDelete.length} running ${checkedTasks.length - canDelete.length === 1 ? 'one is' : 'are'} skipped.`}
          </span>
          <TextButton disabled={!!bulkProgress} onClick={bulkDelete}>
            {bulkProgress || 'Delete'}
          </TextButton>
          <TextButton disabled={!!bulkProgress} onClick={() => setBulkPanel(null)}>
            Keep
          </TextButton>
        </div>
      )}
      {bulkReport && (
        <p className="m-0 flex flex-wrap items-baseline gap-x-3 py-1 text-caption" role="status">
          <span>{bulkReport}</span>
          <TextButton muted onClick={() => setBulkReport('')} className="text-caption">
            Dismiss
          </TextButton>
        </p>
      )}

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
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
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
                selecting={selecting}
                checked={checked.has(id)}
                onCheck={(shift) => toggleCheck(id, shift)}
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
