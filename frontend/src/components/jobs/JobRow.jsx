import React from 'react';
import { href } from '../../router';
import RetryPanel from '../RetryPanel';
import TextButton from '../TextButton';
import Hairline from './Hairline';
import {
  CANCELLABLE,
  IN_FLIGHT,
  RETRYABLE,
  formatBpmKey,
  formatDuration,
  formatWhen,
  jobName,
  modelText,
  statusProgress,
  statusText,
} from './format';

// Column templates per pane-width tier (see JobsPane). Name takes the rest;
// the actions column (--acts) widens on touch, where each word is a 44px
// target.
export const GRID = {
  wide: 'grid-cols-[minmax(0,1fr)_2.75rem_8.5rem_5.5rem_9.5rem_3.75rem_var(--acts)]',
  medium: 'grid-cols-[minmax(0,1fr)_2.75rem_8.5rem_9.5rem_var(--acts)]',
};

/** Column labels for the single-line tiers. */
export function JobsHeaderRow({ tier }) {
  if (tier === 'narrow') return null;
  return (
    <div aria-hidden="true" className={`grid ${GRID[tier]} gap-x-3 pt-1 text-caption text-muted`}>
      <span>Name</span>
      <span>Length</span>
      <span>Model</span>
      {tier === 'wide' && <span>Tempo · Key</span>}
      <span>Status</span>
      {tier === 'wide' && <span>Created</span>}
      <span className="text-right">Actions</span>
    </div>
  );
}

function rowActions(task, cancelling) {
  const s = task.status;
  const list = [{ key: 'open', label: s === 'downloaded' ? 'Review' : 'Open', href: href(`/split/job/${task.task_id}`) }];
  if (CANCELLABLE.has(s)) list.push({ key: 'cancel', label: cancelling ? 'Cancelling...' : 'Cancel', disabled: cancelling });
  if (RETRYABLE.has(s)) list.push({ key: 'retry', label: 'Retry', panel: 'retry' });
  if (!IN_FLIGHT.has(s)) list.push({ key: 'delete', label: s === 'downloaded' ? 'Discard' : 'Delete', panel: 'delete' });
  return list;
}

function MoreIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="5" cy="12" r="0.75" />
      <circle cx="12" cy="12" r="0.75" />
      <circle cx="19" cy="12" r="0.75" />
    </svg>
  );
}

function Actions({ actions, task, panel, onAction, className = '' }) {
  return (
    <div className={`flex items-center gap-x-3 ${className}`}>
      {actions.map((a) =>
        a.href ? (
          <a key={a.key} href={a.href} data-label={a.label} className="link">
            {a.label}
          </a>
        ) : (
          <TextButton
            key={a.key}
            disabled={a.disabled}
            current={a.panel && panel === a.panel}
            aria-expanded={a.panel ? panel === a.panel : undefined}
            aria-label={`${a.label} ${jobName(task)}`}
            label={a.label}
            onClick={() => onAction(a)}
          >
            {a.label}
          </TextButton>
        )
      )}
    </div>
  );
}

/**
 * One job. Single line (40 px) when the pane is wide enough, otherwise two
 * lines (56 px) where the whole row opens the job and the secondary actions
 * sit behind "⋯". Retry, delete confirmation and the phone action list open
 * as a strip under the row.
 */
export default function JobRow({
  task,
  tier,
  current = false,
  panel,
  onTogglePanel,
  onCancel,
  onDelete,
  onRetryStarted,
  busy,
  cancelling,
  error,
  now,
}) {
  const id = task.task_id;
  const name = jobName(task);
  const status = statusText(task, { cancelling });
  const progress = statusProgress(task);
  const actions = rowActions(task, cancelling);
  const showError = (task.status === 'failed' || task.status === 'download_failed') && task.error;
  const openHref = href(`/split/job/${id}`);

  const onAction = (a) => {
    if (a.key === 'cancel') onCancel();
    else if (a.panel) onTogglePanel(a.panel);
  };

  const retryMarker = task.retry_of ? <span className="text-caption text-muted"> · retry</span> : null;

  return (
    <li data-job-row className="flex flex-col">
      {tier === 'narrow' ? (
        <div className="relative flex min-h-14 items-center gap-2 py-1.5">
          <div className="min-w-0 flex-1">
            {/* the name's ::before stretches over the row: tapping anywhere opens */}
            <a
              href={openHref}
              aria-current={current ? 'page' : undefined}
              className={`block truncate weight-hover before:absolute before:inset-0 before:content-[''] ${current ? 'weight-up' : ''}`}
            >
              {name}
              {retryMarker}
            </a>
            <p className="m-0 truncate text-caption text-muted">
              <span className="text-ink">{status}</span>
              {[formatDuration(task.duration), modelText(task), formatWhen(task.created_at, now)]
                .filter(Boolean)
                .map((x) => ` · ${x}`)
                .join('')}
            </p>
          </div>
          <button
            type="button"
            className="link relative z-10 h-11 w-11 shrink-0 text-h3"
            aria-label={`Actions for ${name}`}
            aria-expanded={panel === 'menu' || panel === 'retry' || panel === 'delete'}
            onClick={() => onTogglePanel(panel ? null : 'menu')}
          >
            <MoreIcon />
          </button>
          {progress !== null && (
            <div className="absolute inset-x-0 bottom-0">
              <Hairline value={progress} label={`${name}: ${status}`} />
            </div>
          )}
        </div>
      ) : (
        <div className={`grid min-h-10 items-center gap-x-3 [@media(pointer:coarse)]:min-h-12 ${GRID[tier]}`}>
          <a
            href={openHref}
            aria-current={current ? 'page' : undefined}
            className={`truncate weight-hover ${current ? 'weight-up' : ''}`}
            title={name}
          >
            {name}
            {retryMarker}
          </a>
          <span className="text-caption tabular-nums text-muted">{formatDuration(task.duration)}</span>
          <span className="truncate text-caption text-muted">{modelText(task)}</span>
          {tier === 'wide' && <span className="truncate text-caption tabular-nums text-muted">{formatBpmKey(task)}</span>}
          <div className="flex min-w-0 flex-col justify-center gap-1">
            <span className="truncate text-caption">{status}</span>
            <Hairline value={progress} label={`${name}: ${status}`} />
          </div>
          {tier === 'wide' && (
            <time dateTime={task.created_at} className="truncate text-caption tabular-nums text-muted">
              {formatWhen(task.created_at, now)}
            </time>
          )}
          <Actions actions={actions} task={task} panel={panel} onAction={onAction} className="justify-end text-caption" />
        </div>
      )}

      {showError && (
        <p className="m-0 pb-2 text-caption">
          <span className="text-muted">Error — </span>
          {task.error}
        </p>
      )}
      {error && (
        <p className="m-0 pb-2 text-caption" role="alert">
          <span className="text-muted">Error — </span>
          {error}
        </p>
      )}

      {panel === 'menu' && (
        <div className="flex flex-col gap-1 border-t border-line py-1">
          <p className="m-0 text-caption text-muted">
            {[formatBpmKey(task), task.created_at && new Date(task.created_at).toLocaleString()].filter(Boolean).join(' · ')}
          </p>
          <Actions actions={actions} task={task} panel={panel} onAction={onAction} className="flex-wrap gap-x-6" />
        </div>
      )}

      {panel === 'delete' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line py-2" role="group" aria-label="Confirm delete">
          <span className="text-caption">
            {task.status === 'downloaded' ? 'Discard this download?' : 'Delete this job and its stems?'} Library samples cut
            from it are kept.
          </span>
          <TextButton disabled={busy === 'delete'} onClick={onDelete}>
            {busy === 'delete' ? 'Deleting...' : task.status === 'downloaded' ? 'Discard' : 'Delete'}
          </TextButton>
          <TextButton disabled={busy === 'delete'} onClick={() => onTogglePanel(null)}>
            Keep
          </TextButton>
        </div>
      )}

      {panel === 'retry' && (
        <RetryPanel
          className="border-t border-line py-2"
          taskId={id}
          initialModel={task.model}
          initialRecover={task.recover}
          initialRecoveryModel={task.recovery_model}
          onStarted={onRetryStarted}
          onCancel={() => onTogglePanel(null)}
        />
      )}
    </li>
  );
}
