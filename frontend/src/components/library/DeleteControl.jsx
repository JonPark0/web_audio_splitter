import React, { useState } from 'react';
import TextButton from '../TextButton';
import { COARSE } from './ui';

/**
 * Two-step delete - no browser dialogs. `onDelete` may be async; the
 * question closes again whatever the outcome (B2: a refused delete used to
 * leave "Delete? Confirm" hanging with no explanation). Errors are shown by
 * the caller, next to the sample.
 */
export default function DeleteControl({ busy, onDelete, confirming: confirmingProp, onConfirmingChange, className = '' }) {
  const controlled = confirmingProp !== undefined;
  const [own, setOwn] = useState(false);
  const confirming = controlled ? confirmingProp : own;
  const setConfirming = (v) => (controlled ? onConfirmingChange?.(v) : setOwn(v));

  if (!confirming) {
    return (
      <TextButton disabled={busy} onClick={() => setConfirming(true)} className={`${COARSE} ${className}`}>
        Delete
      </TextButton>
    );
  }

  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-3 gap-y-0 ${className}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') setConfirming(false);
      }}
    >
      {/* the question is what the reader acts on, so ink (muted is for asides) */}
      <span>Delete?</span>
      <TextButton
        disabled={busy}
        className={COARSE}
        onClick={async () => {
          try {
            await onDelete();
          } finally {
            setConfirming(false);
          }
        }}
      >
        Confirm
      </TextButton>
      {/* Focus lands on Cancel, Confirm is one Tab away: on Confirm, the
          next Space (play) or Enter (rename) deleted the sample. */}
      <TextButton autoFocus muted disabled={busy} onClick={() => setConfirming(false)} className={COARSE}>
        Cancel
      </TextButton>
    </span>
  );
}
