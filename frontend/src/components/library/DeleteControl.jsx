import React, { useState } from 'react';
import TextButton from '../TextButton';

/** Two-step delete inside the row - no browser dialogs. */
export default function DeleteControl({ busy, onDelete }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <TextButton muted disabled={busy} onClick={() => setConfirming(true)}>
        Delete
      </TextButton>
    );
  }

  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-x-3 gap-y-1"
      onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}
    >
      <span className="text-muted">Delete?</span>
      <TextButton autoFocus disabled={busy} onClick={onDelete}>
        Confirm
      </TextButton>
      <TextButton muted disabled={busy} onClick={() => setConfirming(false)}>
        Cancel
      </TextButton>
    </span>
  );
}
