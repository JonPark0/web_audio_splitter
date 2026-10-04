import React from 'react';
import TextButton from '../TextButton';
import { KEYS } from '../../samplesApi';
import { formatKey } from './format';
import { COARSE, TOUCH_TEXT } from './ui';

/**
 * Key select (inspector only - one 24-option select per row was a big part
 * of the old list's DOM weight). Choosing a key sets the override; Reset
 * reverts to detected. Labels follow the Camelot preference.
 */
export default function KeyControl({ sample, busy, onPatch, camelot = false }) {
  const { key, key_detected: detected, key_overridden: overridden } = sample;

  const onChange = (e) => {
    const next = e.target.value;
    if (next && next !== key) onPatch({ key: next });
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex items-baseline gap-3">
        <label htmlFor={`key-${sample.id}`} className="w-10 shrink-0 text-caption text-muted">
          Key
        </label>
        <select
          id={`key-${sample.id}`}
          value={key ?? ''}
          disabled={busy}
          onChange={onChange}
          onKeyDown={(e) => e.stopPropagation()}
          className={`ainput w-40 !pb-0.5 ${TOUCH_TEXT}`}
        >
          {key == null && <option value="">—</option>}
          {/* Keep an unexpected backend value selectable rather than silently showing another. */}
          {key != null && !KEYS.includes(key) && <option value={key}>{key}</option>}
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {camelot ? formatKey(k, { camelot: true }) : k}
            </option>
          ))}
        </select>
      </div>
      {overridden && (
        <div className="flex flex-wrap items-baseline gap-x-4 pl-[52px] text-caption">
          <span className="text-muted">detected {detected ? formatKey(detected, { camelot }) : '—'}</span>
          <TextButton disabled={busy} onClick={() => onPatch({ key: null })} title="Use the detected key" className={COARSE}>
            Reset
          </TextButton>
        </div>
      )}
    </div>
  );
}
