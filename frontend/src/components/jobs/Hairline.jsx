import React from 'react';

/**
 * 1px progress line: `line` track, `ink` fill. `value` is a fraction 0..1,
 * 'indeterminate' (a sliding third — hidden under reduced motion, the text
 * beside it says what's happening) or null (nothing).
 */
export default function Hairline({ value, label = 'Progress', className = '' }) {
  if (value === null || value === undefined) return null;
  const determinate = typeof value === 'number';
  return (
    <div
      className={`relative h-px w-full overflow-hidden bg-line ${className}`}
      role="progressbar"
      aria-label={label}
      {...(determinate ? { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(value * 100) } : {})}
    >
      {determinate ? (
        <div
          className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-440 ease-out"
          style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
        />
      ) : (
        <div className="absolute inset-y-0 left-0 w-1/3 animate-slide bg-ink" />
      )}
    </div>
  );
}
