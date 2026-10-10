import React, { useEffect, useRef } from 'react';
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
// the checkbox (--chk) and actions (--acts) columns widen on touch, where
// each control is a 44px target.
export const GRID = {
  wide: 'grid-cols-[var(--chk)_minmax(0,1fr)_2.75rem_8.5rem_5.5rem_9.5rem_3.75rem_var(--acts)]',
  medium: 'grid-cols-[var(--chk)_minmax(0,1fr)_2.75rem_8.5rem_9.5rem_var(--acts)]',
};

/** A row's (or the header's) selection checkbox in a full-height hit area. */
export function CheckCell({ checked, indeterminate = false, onToggle, label, className = '' }) {
  return (
    <label className={`flex h-full min-h-10 cursor-pointer items-center justify-center coarse:min-h-11 ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        onChange={() => {}}
        onClick={(e) => onToggle(e.shiftKey)}
        aria-label={label}
        className="m-0 h-3.5 w-3.5 cursor-pointer coarse:h-5 coarse:w-5"
      />
    </label>
  );
}

/** Column labels for the single-line tiers, with the select-all box. */
export function JobsHeaderRow({ tier, allChecked = false, someChecked = false, onCheckAll }) {
  if (tier === 'narrow') return null;
  return (
    <div className={`grid ${GRID[tier]} items-center gap-x-3 text-caption text-muted`}>
      <CheckCell
        checked={allChecked}
        indeterminate={someChecked && !allChecked}
        onToggle={() => onCheckAll?.()}
        label={allChecked ? 'Unselect all jobs' : 'Select all jobs'}
        className="!min-h-7 coarse:!min-h-11"
      />
      <span aria-hidden="true">Name</span>
      <span>Length</span>
      <span>Model</span>
      {tier === 'wide' && <span aria-hidden="true">Tempo · Key</span>}
      <span aria-hidden="true">Status</span>
      {tier === 'wide' && <span aria-hidden="true">Created</span>}
      <span aria-hidden="true" className="text-right">Actions</span>
    </div>
  );
}

// Panels that open as a strip under the row (the phone's "⋯" menu doesn't
// count: it is a disclosure that keeps focus on its toggle).
const STRIPS = new Set(['cancel', 'retry', 'delete']);

function rowActions(task, cancelling) {
  const s = task.status;
  const list = [{ key: 'open', label: s === 'downloaded' ? 'Review' : 'Open', href: href(`/split/job/${task.task_id}`) }];
  // Cancel asks first, like Delete: it sits next to Open and loses the work done so far.
  if (CANCELLABLE.has(s)) list.push({ key: 'cancel', label: cancelling ? 'Cancelling...' : 'Cancel', disabled: cancelling, panel: 'cancel' });
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
            data-action={a.key}
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
 * sit behind "⋯". Retry, cancel and delete confirmation and the phone action
 * list open as a strip under the row; focus goes into a strip when it opens
 * and back to its action when it closes. On touch, where there is no hover
 * title, long names wrap to a second line. A checkbox selects the row for
 * bulk actions: always shown on the single-line tiers; on the narrow one
 * while selecting, when tapping the row checks it instead of opening it.
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
  selecting = false,
  checked = false,
  onCheck,
}) {
  const id = task.task_id;
  const name = jobName(task);
  const status = statusText(task, { cancelling });
  const progress = statusProgress(task);
  const actions = rowActions(task, cancelling);
  const showError = (task.status === 'failed' || task.status === 'download_failed') && task.error;
  const openHref = href(`/split/job/${id}`);
  const canCancel = CANCELLABLE.has(task.status);

  const onAction = (a) => {
    if (a.panel) onTogglePanel(a.panel);
  };

  const rowRef = useRef(null);
  const stripRef = useRef(null);
  const moreRef = useRef(null);
  const prevPanel = useRef(panel);
  useEffect(() => {
    const was = prevPanel.current;
    prevPanel.current = panel;
    if (panel === was) return;
    if (STRIPS.has(panel)) {
      stripRef.current?.querySelector('button:not(:disabled), select, input, a[href]')?.focus();
    } else if (STRIPS.has(was) && (!document.activeElement || document.activeElement === document.body)) {
      // closed with focus inside it (Keep, a cancel or retry that went through)
      const row = rowRef.current;
      (row?.querySelector(`[data-action="${was}"]:not(:disabled)`) || moreRef.current || row?.querySelector('a[href]'))?.focus();
    }
  }, [panel]);

  const retryMarker = task.retry_of ? <span className="text-caption text-muted"> · retry</span> : null;

  return (
    <li ref={rowRef} data-job-row={id} className={`flex flex-col ${checked ? 'bg-wash' : ''}`}>
      {tier === 'narrow' ? (
        <div className="relative flex min-h-14 items-center gap-2 py-1.5">
          {selecting && (
            <CheckCell checked={checked} onToggle={(shift) => onCheck(shift)} label={`Select ${name}`} className="relative z-10 -ml-1 w-11 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            {/* the name's ::before stretches over the row: tapping anywhere
                opens — or, while selecting, checks the row */}
            {selecting ? (
              <button
                type="button"
                aria-pressed={checked}
                onClick={(e) => onCheck(e.shiftKey)}
                className="line-clamp-2 w-full break-words border-0 bg-transparent p-0 text-left before:absolute before:inset-0 before:content-['']"
              >
                {name}
                {retryMarker}
              </button>
            ) : (
              <a
                href={openHref}
                aria-current={current ? 'page' : undefined}
                className={`line-clamp-2 break-words weight-hover before:absolute before:inset-0 before:content-[''] ${current ? 'weight-up' : ''}`}
              >
                {name}
                {retryMarker}
              </a>
            )}
            <p className="m-0 truncate text-caption text-muted">
              <span className="text-ink">{status}</span>
              {[formatDuration(task.duration), modelText(task), formatWhen(task.created_at, now)]
                .filter(Boolean)
                .map((x) => ` · ${x}`)
                .join('')}
            </p>
          </div>
          <button
            ref={moreRef}
            type="button"
            className="link relative z-10 h-11 w-11 shrink-0 text-h3"
            aria-label={`Actions for ${name}`}
            aria-expanded={panel === 'menu' || STRIPS.has(panel)}
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
        <div className={`grid min-h-10 items-center gap-x-3 coarse:min-h-12 coarse:py-1 ${GRID[tier]}`}>
          <CheckCell checked={checked} onToggle={(shift) => onCheck(shift)} label={`Select ${name}`} />
          <a
            href={openHref}
            aria-current={current ? 'page' : undefined}
            className={`truncate weight-hover coarse:line-clamp-2 coarse:whitespace-normal coarse:break-words ${current ? 'weight-up' : ''}`}
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

      {panel === 'cancel' && canCancel && (
        <div ref={stripRef} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line py-2" role="group" aria-label="Confirm cancel">
          <span className="text-caption">Cancel this job? The work done on it so far is lost.</span>
          <TextButton disabled={cancelling} onClick={onCancel}>
            {cancelling ? 'Cancelling...' : 'Cancel job'}
          </TextButton>
          <TextButton disabled={cancelling} onClick={() => onTogglePanel(null)}>
            Keep running
          </TextButton>
        </div>
      )}

      {panel === 'delete' && (
        <div ref={stripRef} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line py-2" role="group" aria-label="Confirm delete">
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
        <div ref={stripRef}>
          <RetryPanel
            className="border-t border-line py-2"
            taskId={id}
            initialModel={task.model}
            initialRecover={task.recover}
            initialRecoveryModel={task.recovery_model}
            onStarted={onRetryStarted}
            onCancel={() => onTogglePanel(null)}
          />
        </div>
      )}
    </li>
  );
}
