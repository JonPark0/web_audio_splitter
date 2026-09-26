import React from 'react';
import WordToggle from './WordToggle';

const OPTIONS = [
  { value: 'original', label: 'Original' },
  { value: 'recovered', label: 'Recovered' },
];

/** Original vs. recovered switch for a single stem. */
export default function ABToggle({ name, variant, onChange, disabled }) {
  return (
    <div
      className="text-caption"
      title={disabled ? 'Recovery was not run for this track' : 'Compare original vs. recovered'}
    >
      <WordToggle
        name={name}
        options={OPTIONS}
        value={variant}
        onChange={onChange}
        disabled={disabled}
        centerOnMobile={false}
      />
    </div>
  );
}
