import React from 'react';

const OPTIONS = [
  { value: 'original', short: 'O', label: 'Original' },
  { value: 'recovered', short: 'R', label: 'Recovered' },
];

/**
 * Original vs. recovered switch for one stem. `compact` draws "O | R" for the
 * mixer's label column (full names in the title and for screen readers);
 * otherwise the words. Switching is instant and stays in sync — both
 * variants play side by side and only their gains change.
 */
export default function ABToggle({ variant, onChange, disabled, compact = false, touch = false, recoveryModel, className = '' }) {
  return (
    <div role="radiogroup" aria-label="Variant" className={`flex items-baseline ${compact ? 'gap-1' : 'gap-4'} ${className}`}>
      {OPTIONS.map((o, i) => {
        const checked = o.value === variant;
        const title = o.value === 'recovered' && recoveryModel ? `${o.label} (${recoveryModel})` : o.label;
        return (
          <React.Fragment key={o.value}>
            {compact && !touch && i > 0 && (
              <span aria-hidden="true" className="text-line">
                |
              </span>
            )}
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={title}
              title={title}
              disabled={disabled}
              data-label={compact ? o.short : o.label}
              onClick={() => onChange(o.value)}
              className={`link rs-hit ${touch ? 'h-11 min-w-11 justify-center' : ''} ${checked ? 'is-current' : 'link--muted'}`}
            >
              {compact ? o.short : o.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
