import React from 'react';
import TextButton from './TextButton';

/** Inline error messaging - plain text, no box, still announced. */
export default function ErrorBanner({ message, onDismiss, className = '' }) {
  if (!message) return null;

  return (
    <div role="alert" className={`flex w-full items-baseline gap-4 ${className}`}>
      <p className="m-0 min-w-0">
        <span className="text-muted">Error — </span>
        {message}
      </p>
      {onDismiss && (
        <TextButton onClick={onDismiss} className="shrink-0 text-caption">
          Dismiss
        </TextButton>
      )}
    </div>
  );
}
