import React from 'react';

/**
 * Word toggle (Palnarium's Published / Draft switch): options are plain words,
 * inactive ones muted, the active one in ink. Real radios underneath so it
 * stays keyboard- and screen-reader-friendly.
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
      className={`flex flex-wrap gap-x-5 gap-y-2 ${centerOnMobile ? 'max-md:justify-center' : ''} ${
        disabled ? 'pointer-events-none opacity-40' : ''
      } ${className}`}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <label key={o.value} className="relative cursor-pointer">
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
              className={`link peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                checked ? 'is-current text-ink' : '!text-muted'
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
