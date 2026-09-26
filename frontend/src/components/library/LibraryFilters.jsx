import React from 'react';
import Field from '../Field';
import TextButton from '../TextButton';
import { KEYS, SORT_OPTIONS } from '../../samplesApi';

/** Search / tag / key / BPM range / sort. Controlled; the screen owns the state. */
export default function LibraryFilters({ filters, tags, onChange, onClear, active }) {
  const set = (field) => (e) => onChange({ ...filters, [field]: e.target.value });

  // Tag counts shift after edits; keep the selected tag listed even if it
  // has dropped out, or the select would quietly show a different value.
  const tagOptions =
    filters.tag && !tags.some((t) => t.name === filters.tag) ? [{ name: filters.tag, count: 0 }, ...tags] : tags;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 text-left md:grid-cols-3 xl:grid-cols-[2fr_1fr_1fr_0.75fr_0.75fr_1fr]">
        <Field label="Search" htmlFor="lib-q" className="col-span-2 md:col-span-3 xl:col-span-1">
          <input
            id="lib-q"
            type="search"
            value={filters.q}
            onChange={set('q')}
            placeholder="Name"
            className="ainput"
          />
        </Field>
        <Field label="Tag" htmlFor="lib-tag">
          <select id="lib-tag" value={filters.tag} onChange={set('tag')} className="ainput">
            <option value="">All</option>
            {tagOptions.map((t) => (
              <option key={t.name} value={t.name}>
                {t.count ? `${t.name} (${t.count})` : t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Key" htmlFor="lib-key">
          <select id="lib-key" value={filters.key} onChange={set('key')} className="ainput">
            <option value="">All</option>
            {KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </Field>
        <Field label="BPM min" htmlFor="lib-bpm-min">
          <input
            id="lib-bpm-min"
            type="number"
            inputMode="decimal"
            min="0"
            value={filters.bpmMin}
            onChange={set('bpmMin')}
            placeholder="—"
            className="ainput tabular-nums"
          />
        </Field>
        <Field label="BPM max" htmlFor="lib-bpm-max">
          <input
            id="lib-bpm-max"
            type="number"
            inputMode="decimal"
            min="0"
            value={filters.bpmMax}
            onChange={set('bpmMax')}
            placeholder="—"
            className="ainput tabular-nums"
          />
        </Field>
        <Field label="Sort" htmlFor="lib-sort">
          <select id="lib-sort" value={filters.sort} onChange={set('sort')} className="ainput">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="min-h-[1.55em] text-caption">
        {active && (
          <TextButton muted onClick={onClear}>
            Clear filters
          </TextButton>
        )}
      </div>
    </div>
  );
}
