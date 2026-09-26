import React from 'react';

/**
 * Staged progress indicator: Separating -> (Restoring, if recovery is on).
 * Backend only reports real fractional progress for the restoring stage
 * (one Demucs subprocess call has no per-file granularity), so the
 * separating stage renders as an indeterminate sliding bar and the
 * restoring stage renders a real stepIndex/stepTotal fraction.
 */
export default function ProgressStages({ recover, step, stepIndex = 0, stepTotal = 0, currentStem, status }) {
  const stages = recover
    ? [
        { key: 'separating', label: 'Separating stems' },
        { key: 'restoring', label: 'Restoring frequencies' },
      ]
    : [{ key: 'separating', label: 'Separating stems' }];

  const activeIndex = Math.max(
    0,
    stages.findIndex((s) => s.key === step)
  );
  const isFailed = status === 'failed';
  const determinate = step === 'restoring' && stepTotal > 0;

  return (
    <div className="flex w-full flex-col gap-6">
      <ol className="m-0 flex list-none flex-col p-0">
        {stages.map((s, i) => {
          const done = i < activeIndex || status === 'completed';
          const active = i === activeIndex && status !== 'completed' && !isFailed;
          return (
            <li
              key={s.key}
              aria-current={active ? 'step' : undefined}
              className={`flex items-baseline justify-between gap-4 py-4 text-left ${i > 0 ? 'border-t border-line' : ''}`}
            >
              <span className="flex items-baseline gap-4">
                <span className="text-caption text-muted tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                <span
                  className={`text-h3 leading-tight ${
                    active ? 'text-ink [font-variation-settings:"wght"_400]' : done ? 'text-ink' : 'text-muted'
                  }`}
                >
                  {s.label}
                </span>
              </span>
              <span className="text-caption text-muted">
                {done ? 'Done' : active ? 'In progress' : isFailed && i === activeIndex ? 'Failed' : 'Waiting'}
              </span>
            </li>
          );
        })}
      </ol>

      <div
        className="relative h-0.5 w-full overflow-hidden bg-line"
        role="progressbar"
        aria-label="Processing progress"
        {...(determinate
          ? { 'aria-valuemin': 0, 'aria-valuemax': stepTotal, 'aria-valuenow': stepIndex }
          : {})}
      >
        {determinate ? (
          <div
            className="absolute inset-y-0 left-0 bg-ink transition-all duration-500"
            style={{ width: `${Math.min(100, (stepIndex / stepTotal) * 100)}%` }}
          />
        ) : (
          !isFailed && <div className="absolute inset-y-0 left-0 w-1/3 animate-slide bg-ink" />
        )}
      </div>

      <p className="m-0 text-center text-muted md:text-left" role="status">
        {isFailed
          ? 'Something went wrong.'
          : step === 'restoring' && currentStem
          ? `Restoring "${currentStem}" (${stepIndex}/${stepTotal})...`
          : step === 'restoring'
          ? 'Restoring frequencies...'
          : 'Separating stems with Demucs AI...'}
      </p>
    </div>
  );
}
