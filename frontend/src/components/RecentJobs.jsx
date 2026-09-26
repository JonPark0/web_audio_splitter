import React, { useEffect, useState } from 'react';
import { getResult, getTasks } from '../api';
import TextButton from './TextButton';

const RUNNING = new Set(['queued', 'processing', 'restoring']);

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

/**
 * Past jobs (persisted server-side), so finished stems can be reopened —
 * e.g. to extract more samples — without re-running the separation.
 */
export default function RecentJobs({ onOpenResult, onOpenProcessing }) {
  const [tasks, setTasks] = useState(null);
  const [opening, setOpening] = useState(null);
  const [error, setError] = useState('');

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
      onOpenResult(task.task_id, res.data);
    } catch (e) {
      setError(e.response?.data?.detail || 'Could not open this job — its files may have been removed.');
    } finally {
      setOpening(null);
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
          const openable = task.status === 'completed' || RUNNING.has(task.status);
          return (
            <li
              key={task.task_id}
              className="flex flex-col gap-1 border-t border-line py-3 md:flex-row md:items-baseline md:justify-between md:gap-6"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate">{task.name || 'Untitled'}</span>
                <span className="text-caption text-muted">
                  {formatWhen(task.created_at)} · {task.model}
                  {task.recover ? ` + ${task.recovery_model}` : ''} · {STATUS_LABELS[task.status] || task.status}
                </span>
              </div>
              {openable && (
                <TextButton
                  className="shrink-0 self-start md:self-auto"
                  disabled={opening === task.task_id}
                  onClick={() => open(task)}
                >
                  {opening === task.task_id ? 'Opening...' : RUNNING.has(task.status) ? 'View progress' : 'Open'}
                </TextButton>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
