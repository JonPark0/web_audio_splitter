import React from 'react';

/**
 * Word toggle (Palnarium's Published / Draft switch, .atoggle): options are
 * plain words. Every word is actionable, so all of them stay in ink (muted
 * is 3.4:1 — too faint for something you must read to act on); the chosen
 * one is marked like the current page: hover weight + underline. Real
 * radios underneath so it stays keyboard- and screen-reader-friendly; focus
 * draws a 2px ink ring around the word. Disabled: every word muted.
 */
export default function WordToggle({
  name,
  options,
  value,
  onChange,
  disabled = false,
  centerOnMobile = false,
  className = '',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      aria-disabled={disabled || undefined}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${centerOnMobile ? 'max-sm:justify-center' : ''} ${className}`}
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
              className={`link toggle-word peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                checked ? 'is-current is-chosen' : ''
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
