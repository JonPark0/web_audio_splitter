import React, { useEffect, useState } from 'react';
import { deleteTask, getResult, getTasks } from '../api';
import RetryPanel from './RetryPanel';
import TextButton from './TextButton';

const RUNNING = new Set(['queued', 'processing', 'restoring']);
// Jobs whose source audio is fully in hand, so they can be re-run.
const RETRYABLE = new Set(['completed', 'failed']);

const STATUS_LABELS = {
  queued: 'Queued',
  downloading: 'Downloading',
  downloaded: 'Awaiting confirmation',
  download_failed: 'Download failed',
  processing: 'Separating',
  restoring: 'Restoring',
  completed: 'Done',
  failed: 'Failed',
};

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function errorDetail(e, fallback) {
  const detail = e.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

/**
 * Past jobs (persisted server-side), so finished stems can be reopened —
 * e.g. to extract more samples — without re-running the separation. Each
 * row can also be re-run with other settings or deleted, both inline.
 */
export default function RecentJobs({ onOpenResult, onOpenProcessing }) {
  const [tasks, setTasks] = useState(null);
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');
  // One inline panel at a time: { id, kind: 'retry' | 'delete' }.
  const [panel, setPanel] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [rowError, setRowError] = useState(null); // { id, message }

  useEffect(() => {
    let cancelled = false;
    getTasks(10)
      .then((res) => !cancelled && setTasks(res.data.tasks))
      .catch(() => !cancelled && setTasks([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!tasks || tasks.length === 0) return null;

  const open = async (task) => {
    setError('');
    if (RUNNING.has(task.status)) {
      onOpenProcessing(task);
      return;
    }
    setOpening(task.task_id);
    try {
      const res = await getResult(task.task_id);
      onOpenResult(task.task_id, res.data, task);
    } catch (e) {
      setError(errorDetail(e, 'Could not open this job — its files may have been removed.'));
    } finally {
      setOpening(null);
    }
  };

  const togglePanel = (id, kind) => {
    setRowError(null);
    setPanel((p) => (p && p.id === id && p.kind === kind ? null : { id, kind }));
  };

  const remove = async (task) => {
    setDeleting(task.task_id);
    setRowError(null);
    try {
      await deleteTask(task.task_id);
      setTasks((ts) => ts.filter((t) => t.task_id !== task.task_id));
      setPanel(null);
    } catch (e) {
      const fallback =
        e.response?.status === 409 ? 'This job is still running — wait for it to finish.' : 'Could not delete this job.';
      setRowError({ id: task.task_id, message: errorDetail(e, fallback) });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <section className="mt-16 flex flex-col gap-4 md:mt-24" aria-labelledby="recent-jobs">
      <h2 id="recent-jobs" className="m-0 text-h3 font-light">
        Recent jobs
      </h2>
      {error && (
        <p className="m-0 text-caption" role="alert">
          <span className="text-muted">Error — </span>
          {error}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col p-0">
        {tasks.map((task) => {
          const id = task.task_id;
          const running = RUNNING.has(task.status);
          const openable = task.status === 'completed' || running;
          const retryable = RETRYABLE.has(task.status);
          const retryOpen = panel?.id === id && panel.kind === 'retry';
          const confirmOpen = panel?.id === id && panel.kind === 'delete';
          return (
            <li key={id} className="flex flex-col border-t border-line py-3">
              <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between md:gap-6">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate">{task.name || 'Untitled'}</span>
                  <span className="text-caption text-muted">
                    {formatWhen(task.created_at)} · {task.model}
                    {task.recover ? ` + ${task.recovery_model}` : ''} · {STATUS_LABELS[task.status] || task.status}
                    {task.retry_of ? ' · retry' : ''}
                  </span>
                </div>

                {confirmOpen ? (
                  <div className="flex shrink-0 items-baseline gap-4 self-start md:self-auto">
                    <span className="text-caption text-muted">Delete job and its files?</span>
                    <TextButton disabled={deleting === id} onClick={() => remove(task)}>
                      {deleting === id ? 'Deleting...' : 'Delete'}
                    </TextButton>
                    <TextButton muted disabled={deleting === id} onClick={() => togglePanel(id, 'delete')}>
                      Cancel
                    </TextButton>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-baseline gap-5 self-start md:self-auto">
                    {openable && (
                      <TextButton disabled={opening === id} onClick={() => open(task)}>
                        {opening === id ? 'Opening...' : running ? 'View progress' : 'Open'}
                      </TextButton>
                    )}
                    {retryable && (
                      <TextButton
                        muted
                        current={retryOpen}
                        aria-expanded={retryOpen}
                        onClick={() => togglePanel(id, 'retry')}
                        title="Run this job again with other settings"
                      >
                        Retry
                      </TextButton>
                    )}
                    <TextButton muted onClick={() => togglePanel(id, 'delete')} title="Delete this job and its files">
                      Delete
                    </TextButton>
                  </div>
                )}
              </div>

              {rowError?.id === id && (
                <p className="m-0 mt-2 text-caption" role="alert">
                  <span className="text-muted">Error — </span>
                  {rowError.message}
                </p>
              )}

              {retryOpen && (
                <RetryPanel
                  className="max-w-xl pb-3 pt-6"
                  taskId={id}
                  initialModel={task.model}
                  initialRecover={task.recover}
                  initialRecoveryModel={task.recovery_model}
                  onStarted={onOpenProcessing}
                  onCancel={() => setPanel(null)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
