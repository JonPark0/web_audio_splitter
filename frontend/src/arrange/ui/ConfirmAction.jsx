import React, { useState } from 'react';
import TextButton from '../../components/TextButton';

/**
 * Two-step destructive action inline - never a browser dialog. With
 * `confirm={false}` it acts on the first click (e.g. deleting an empty track).
 */
export default function ConfirmAction({ label = 'Delete', question = 'Delete?', confirm = true, disabled, onConfirm, className = '', title }) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <TextButton
        muted
        disabled={disabled}
        title={title}
        className={className}
        onClick={() => (confirm ? setAsking(true) : onConfirm())}
      >
        {label}
      </TextButton>
    );
  }

  return (
    <span
      className={`inline-flex flex-wrap items-baseline gap-x-3 gap-y-1 ${className}`}
      onKeyDown={(e) => e.key === 'Escape' && setAsking(false)}
    >
      <span>{question}</span>
      <TextButton
        autoFocus
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Confirm
      </TextButton>
      <TextButton muted onClick={() => setAsking(false)}>
        Cancel
      </TextButton>
    </span>
  );
}
