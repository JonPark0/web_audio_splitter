import React, { useId } from 'react';
import { SEPARATION_MODELS } from '../../api';
import Field from '../Field';

// Recommended first, with the reason in the option itself (phones show
// only the native picker, no hint line).
const RECOMMENDED_LABELS = {
  bs_roformer: 'BS-Roformer — 6 stems, best quality',
  htdemucs: 'htdemucs — 4 stems, fast',
};
const RECOMMENDED = ['bs_roformer', 'htdemucs']
  .map((v) => SEPARATION_MODELS.find((m) => m.value === v))
  .filter(Boolean);
const OTHERS = SEPARATION_MODELS.filter((m) => !RECOMMENDED.includes(m));

/** Separation model picker as a dense label-left row + one-line hint. */
export default function ModelSelect({ value, onChange, disabled = false, label = 'Model' }) {
  const id = useId();
  const active = SEPARATION_MODELS.find((m) => m.value === value);
  return (
    <div className="flex flex-col gap-1">
      <Field inline label={label} htmlFor={id}>
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="ainput"
        >
          <optgroup label="Recommended">
            {RECOMMENDED.map((m) => (
              <option key={m.value} value={m.value}>
                {RECOMMENDED_LABELS[m.value] || m.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="More models">
            {OTHERS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {active?.hint && (
        <p className="m-0 pl-[calc(5rem+0.75rem)] text-caption text-muted max-sm:hidden">{active.hint}</p>
      )}
    </div>
  );
}
