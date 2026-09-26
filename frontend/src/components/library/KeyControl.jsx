import React from 'react';
import TextButton from '../TextButton';
import { KEYS } from '../../samplesApi';

/** Key select: choosing a key sets the override, Reset reverts to detected. */
export default function KeyControl({ sample, busy, onPatch }) {
  const { key, key_detected: detected, key_overridden: overridden } = sample;

  const onChange = (e) => {
    const next = e.target.value;
    if (next && next !== key) onPatch({ key: next });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <label htmlFor={`key-${sample.id}`} className="text-caption text-muted">
          Key
        </label>
        <select
          id={`key-${sample.id}`}
          value={key ?? ''}
          disabled={busy}
          onChange={onChange}
          className="ainput w-32 !pb-1"
        >
          {key == null && <option value="">—</option>}
          {/* Keep an unexpected backend value selectable rather than silently showing another. */}
          {key != null && !KEYS.includes(key) && <option value={key}>{key}</option>}
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      {overridden && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
          <span className="text-muted">(detected {detected ?? '—'})</span>
          <TextButton muted disabled={busy} onClick={() => onPatch({ key: null })} title="Use the detected key">
            Reset
          </TextButton>
        </div>
      )}
    </div>
  );
}
