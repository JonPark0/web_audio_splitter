/**
 * Job status vocabulary and small formatters shared by the jobs list, the
 * job view and the header badge.
 */

// Queued or running on the worker (the server's IN_FLIGHT_STATUSES).
export const IN_FLIGHT = new Set(['queued', 'downloading', 'processing', 'restoring']);
// On the GPU worker: these can be cancelled.
export const CANCELLABLE = new Set(['queued', 'processing', 'restoring']);
// Nothing more will happen without the user.
export const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'download_failed']);
// Finished with the source audio in hand, so it can be re-run.
export const RETRYABLE = new Set(['completed', 'failed', 'cancelled']);

export const STATUS_LABELS = {
  downloading: 'Downloading',
  downloaded: 'Ready to review',
  download_failed: 'Download failed',
  queued: 'Queued',
  processing: 'Separating',
  restoring: 'Restoring',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  cancelling: 'Cancelling...',
};

/** Status filter words of the jobs list → the server's comma-separated filter. */
export const STATUS_FILTERS = [
  { value: 'all', label: 'All', statuses: null },
  { value: 'running', label: 'Running', statuses: ['downloading', 'downloaded', 'queued', 'processing', 'restoring'] },
  { value: 'done', label: 'Done', statuses: ['completed'] },
  { value: 'failed', label: 'Failed', statuses: ['failed', 'download_failed', 'cancelled'] },
];

/** One line saying where a job is: "Queued · 2 ahead", "Restoring 3/6 guitar". */
export function statusText(task, { cancelling = false } = {}) {
  if (cancelling && CANCELLABLE.has(task.status)) return STATUS_LABELS.cancelling;
  switch (task.status) {
    case 'queued':
      // queue_position is 1-based among waiting jobs; jobs only wait while
      // the (single) worker is busy, so one more is running ahead of them.
      return task.queue_position ? `Queued · ${task.queue_position} ahead` : 'Queued';
    case 'downloading':
      return Number.isFinite(task.download_percent) ? `Downloading ${task.download_percent}%` : 'Downloading';
    case 'restoring': {
      const total = task.step_total || 0;
      if (!total) return 'Restoring';
      const k = Math.min(total, (task.step_index || 0) + 1);
      return `Restoring ${k}/${total}${task.current_stem ? ` ${task.current_stem}` : ''}`;
    }
    default:
      return STATUS_LABELS[task.status] || task.status;
  }
}

/**
 * Progress for the status hairline: a fraction 0..1, 'indeterminate', or
 * null (no bar).
 */
export function statusProgress(task) {
  if (task.status === 'downloading') {
    return Number.isFinite(task.download_percent) ? task.download_percent / 100 : 'indeterminate';
  }
  if (task.status === 'restoring' && task.step_total) {
    return Math.min(1, (task.step_index || 0) / task.step_total);
  }
  if (task.status === 'processing' || task.status === 'restoring') return 'indeterminate';
  return null;
}

export function modelText(task) {
  if (!task?.model) return '';
  return task.recover ? `${task.model} + ${task.recovery_model}` : task.model;
}

export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** "45 s", "3 min", "1 h 05 min" — for elapsed / remaining time. */
export function formatSpan(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '';
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function formatBpmKey(task) {
  const bpm = Number.isFinite(task?.bpm) ? `${Math.round(task.bpm)} BPM` : '';
  const key = task?.key ? shortKey(task.key) : '';
  return [bpm, key].filter(Boolean).join(' · ');
}

/** "A major" → "A", "F# minor" → "F#m" (the producer's shorthand). */
export function shortKey(key) {
  const [pitch, mode] = String(key).split(' ');
  if (!mode) return key;
  return mode === 'minor' ? `${pitch}m` : pitch;
}

/** Today "18:29", yesterday "Yesterday 18:29", this year "Oct 4", else "Oct 4, 2025". */
export function formatWhen(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86400000);
  if (diffDays === 0) return time;
  if (diffDays === 1) return `Yesterday ${time}`;
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

export function formatMB(bytes) {
  if (!Number.isFinite(bytes)) return '';
  return (bytes / (1024 * 1024)).toFixed(1);
}

export function jobName(task) {
  return task?.name || task?.title || task?.source_name || 'Untitled';
}
