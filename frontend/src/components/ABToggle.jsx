import React from 'react';

const OPTIONS = [
  { value: 'original', short: 'O', label: 'Original' },
  { value: 'recovered', short: 'R', label: 'Recovered' },
];

/**
 * Original vs. recovered switch for one stem. `compact` draws "O | R" for the
 * mixer's label column (full names in the title and for screen readers);
 * otherwise the words. `compact touch` is one 44 px switch that flips, so the
 * fader sharing its line isn't squeezed by two 44 px buttons. Switching is
 * instant and stays in sync — both variants play side by side and only their
 * gains change.
 */
export default function ABToggle({ variant, onChange, disabled, compact = false, touch = false, recoveryModel, className = '' }) {
  if (compact && touch) {
    const recovered = variant === 'recovered';
    const model = recoveryModel ? ` (${recoveryModel})` : '';
    const mark = (on) => (on ? 'weight-up toggle-word is-chosen' : 'text-muted');
    return (
      <button
        type="button"
        role="switch"
        aria-checked={recovered}
        aria-label={`Recovered version${model}`}
        title={recovered ? `Recovered${model} — tap for the original` : 'Original — tap for the recovered version'}
        disabled={disabled}
        data-label="O|R"
        onClick={() => onChange(recovered ? 'original' : 'recovered')}
        className={`link h-11 min-w-11 justify-center ${className}`}
      >
        <span className="flex gap-1">
          <span className={mark(!recovered)}>O</span>
          <span aria-hidden="true" className="text-line">
            |
          </span>
          <span className={mark(recovered)}>R</span>
        </span>
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label="Variant" className={`flex items-baseline ${compact ? 'gap-1' : 'gap-4'} ${className}`}>
      {OPTIONS.map((o, i) => {
        const checked = o.value === variant;
        const title = o.value === 'recovered' && recoveryModel ? `${o.label} (${recoveryModel})` : o.label;
        return (
          <React.Fragment key={o.value}>
            {compact && i > 0 && (
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
              className={`link rs-hit ${checked ? 'is-current' : 'link--muted'}`}
            >
              {compact ? o.short : o.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}
