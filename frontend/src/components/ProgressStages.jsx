import React from 'react';

/**
 * Where a job is, as one compact row of stages: Queued (with its place in
 * line) → Separating → Restoring k/n <stem> (only with restoration). The
 * server reports real fractions for restoring only (one separator
 * subprocess has no per-file granularity), so the hairline under it — drawn
 * by the caller — is time-based before that.
 */
export default function ProgressStages({ task }) {
  const recover = !!task.recover;
  const s = task.status;
  const stages = [
    { key: 'queued', label: 'Queued' },
    { key: 'separating', label: 'Separating' },
    ...(recover ? [{ key: 'restoring', label: 'Restoring' }] : []),
  ];

  let activeIndex;
  if (s === 'queued') activeIndex = 0;
  else if (s === 'processing') activeIndex = 1;
  else if (s === 'restoring') activeIndex = 2;
  else if (s === 'completed') activeIndex = stages.length;
  else activeIndex = task.step === 'restoring' && recover ? 2 : task.started_at ? 1 : 0; // failed / cancelled
  const ended = s === 'failed' || s === 'cancelled';

  const detail = (key) => {
    if (key === 'queued' && s === 'queued' && task.queue_position) return `${task.queue_position} ahead`;
    if (key === 'restoring' && (s === 'restoring' || (ended && task.step === 'restoring')) && task.step_total) {
      const k = Math.min(task.step_total, (task.step_index || 0) + (s === 'restoring' ? 1 : 0));
      return `${k}/${task.step_total}${task.current_stem && s === 'restoring' ? ` ${task.current_stem}` : ''}`;
    }
    return '';
  };

  return (
    <ol className="m-0 flex list-none flex-wrap items-baseline gap-x-6 gap-y-1 p-0">
      {stages.map((st, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex && !ended;
        const stopped = i === activeIndex && ended;
        const state = done ? 'done' : active ? 'now' : stopped ? (s === 'cancelled' ? 'cancelled' : 'failed') : 'waiting';
        const extra = detail(st.key);
        return (
          <li key={st.key} aria-current={active ? 'step' : undefined} className="flex items-baseline gap-2">
            <span className="text-caption tabular-nums text-muted">{String(i + 1).padStart(2, '0')}</span>
            <span className={active ? 'weight-up' : done || stopped ? '' : 'text-muted'}>
              {st.label}
              {extra && <span className="tabular-nums"> {extra}</span>}
            </span>
            <span className="text-caption text-muted">
              {state === 'now' ? 'in progress' : state === 'waiting' ? '' : state}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
