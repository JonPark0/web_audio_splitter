import React, { useState } from 'react';
import { FiMoreHorizontal, FiX } from 'react-icons/fi';
import TextButton from '../TextButton';

const icon = (C) => <C className="icon" strokeWidth={1.5} aria-hidden="true" />;

// "Delete" when every checked job qualifies, "Delete 2" when only some do.
const label = (word, n, count) => (n === count ? word : `${word} ${n}`);

/**
 * Bulk actions for the checked jobs; takes over the jobs toolbar row while
 * anything is checked (or, on a narrow list, while selecting). Each action
 * only applies to the jobs it fits — Cancel to queued/running ones, Retry to
 * finished ones, Delete to ones that aren't running — and says how many.
 */
export default function BulkJobsBar({ narrow, count, total, eligible, panel, progress, onSelectAll, onClear, onCancel, onTogglePanel }) {
  const [more, setMore] = useState(false);
  const busy = !!progress;
  const selectAll = count < total && (
    <TextButton disabled={busy} onClick={onSelectAll} className="whitespace-nowrap">
      {`Select all ${total}`}
    </TextButton>
  );
  const cancel = eligible.cancel > 0 && (
    <TextButton disabled={busy} onClick={onCancel} title="Stop the queued or running ones">
      {label('Cancel', eligible.cancel, count)}
    </TextButton>
  );
  const retry = eligible.retry > 0 && (
    <TextButton disabled={busy} current={panel === 'retry'} aria-expanded={panel === 'retry'} onClick={() => onTogglePanel('retry')}>
      {`${label('Retry', eligible.retry, count)}…`}
    </TextButton>
  );
  const del = eligible.delete > 0 && (
    <TextButton disabled={busy} current={panel === 'delete'} aria-expanded={panel === 'delete'} onClick={() => onTogglePanel('delete')}>
      {label('Delete', eligible.delete, count)}
    </TextButton>
  );

  if (narrow) {
    return (
      <div className="flex flex-col">
        <div className="flex h-11 items-center gap-3">
          <TextButton label="" aria-label="Stop selecting" onClick={onClear} className="-ml-2.5 h-11 w-11 justify-center">
            {icon(FiX)}
          </TextButton>
          <span className="min-w-0 flex-1 truncate tabular-nums" aria-live="polite">
            {progress || `${count} selected`}
          </span>
          {retry}
          {del}
          <TextButton label="" aria-label="More bulk actions" aria-expanded={more} onClick={() => setMore((m) => !m)} className="h-11 w-11 justify-center">
            {icon(FiMoreHorizontal)}
          </TextButton>
        </div>
        {more && (
          <div className="flex flex-wrap items-center gap-x-5 text-caption">
            {selectAll}
            {cancel}
            {!selectAll && !cancel && <span className="py-3 text-muted">Nothing else for these jobs.</span>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-11 items-center gap-x-5">
      <span className="shrink-0 whitespace-nowrap text-h4 font-light tabular-nums" aria-live="polite">
        {count} selected
      </span>
      {selectAll}
      {cancel}
      {retry}
      {del}
      {count > 0 && !eligible.cancel && !eligible.retry && !eligible.delete && (
        <span className="text-caption text-muted">No bulk action fits these jobs.</span>
      )}
      {progress && <span className="min-w-0 truncate text-caption tabular-nums text-muted">{progress}</span>}
      <TextButton muted onClick={onClear} className="ml-auto shrink-0 whitespace-nowrap" title="Esc">
        Clear selection
      </TextButton>
    </div>
  );
}
