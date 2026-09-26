import React from 'react';

/**
 * Word toggle (Palnarium's Published / Draft switch, .atoggle): options are
 * plain words, the chosen one in ink, the others muted - colour alone marks
 * the choice, as on Palnarium. Unchosen words still answer hover with the
 * link weight. Real radios underneath so it stays keyboard- and
 * screen-reader-friendly; focus draws a 2px ink ring around the word.
 */
export default function WordToggle({
  name,
  options,
  value,
  onChange,
  disabled = false,
  centerOnMobile = true, // Split screens centre everything on mobile
  className = '',
}) {
  return (
    <div
      role="radiogroup"
      aria-disabled={disabled || undefined}
      className={`flex flex-wrap gap-x-5 gap-y-2 ${centerOnMobile ? 'max-md:justify-center' : ''} ${className}`}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label key={o.value} className={`relative ${disabled ? 'cursor-default' : 'cursor-pointer'}`}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(o.value)}
              className="peer absolute h-px w-px opacity-0"
            />
            <span
              data-label={o.label}
              aria-disabled={disabled || undefined}
              className={`link peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                checked && !disabled ? '' : '!text-muted'
              }`}
            >
              {o.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
