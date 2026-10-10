import React, { useEffect, useRef, useState } from 'react';
import { isComposing, parseDecimal } from '../../keys';
import { KEYS, SORT_OPTIONS } from '../../samplesApi';
import { formatKey } from './format';
import { Popover } from './Sheet';
import { COARSE, TOUCH_TEXT } from './ui';

/** Draft that follows `value` from outside and commits after a pause. */
export function useDraft(value, commit, delay = 400) {
  const [draft, setDraft] = useState(value);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const lastRef = useRef(value);
  useEffect(() => {
    // URL changed elsewhere (Clear, Back) - follow it
    if (value !== lastRef.current) {
      lastRef.current = value;
      setDraft(value);
    }
  }, [value]);
  useEffect(() => {
    if (draft === lastRef.current) return undefined;
    const t = setTimeout(() => {
      lastRef.current = draft;
      commitRef.current(draft);
    }, delay);
    return () => clearTimeout(t);
  }, [draft, delay]);
  const flush = () => {
    if (draft !== lastRef.current) {
      lastRef.current = draft;
      commitRef.current(draft);
    }
  };
  return [draft, setDraft, flush];
}

// Keys stay in the field (Space, arrows, Delete aren't list shortcuts
// here) - except Escape, which closes the sheet/popover around it.
const stop = (e) => e.key !== 'Escape' && e.stopPropagation();

/** The tag checklist: popover on desktop, inside the filter sheet on touch. */
export function TagChecklist({ tags, selected, onChange, rowClass = 'min-h-8 px-3 coarse:min-h-11' }) {
  const [find, setFind] = useState('');
  // Keep selected tags listed even if they've dropped out of the counts.
  const all = [...selected.filter((t) => !tags.some((x) => x.name === t)).map((name) => ({ name, count: 0 })), ...tags];
  const shown = find ? all.filter((t) => t.name.includes(find.trim().toLowerCase())) : all;
  const toggle = (name) =>
    onChange(selected.includes(name) ? selected.filter((t) => t !== name) : [...selected, name]);
  return (
    <div className="flex flex-col">
      {all.length > 8 && (
        <input
          type="search"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            // Escape empties the search first, then closes
            if (e.key === 'Escape' && find && !isComposing(e)) {
              e.preventDefault();
              setFind('');
            }
            stop(e);
          }}
          placeholder="Find tag"
          aria-label="Find tag"
          className={`ainput my-2 w-auto !pb-1 ${rowClass.includes('px-3') ? 'mx-3' : 'mx-4 sm:mx-6'} ${TOUCH_TEXT}`}
        />
      )}
      {!all.length && <p className="m-0 px-3 py-2 text-caption text-muted">No tags yet.</p>}
      {shown.map((t) => (
        <label key={t.name} className={`flex cursor-pointer items-center gap-3 border-b border-line last:border-b-0 hover:bg-wash ${rowClass}`}>
          <input type="checkbox" checked={selected.includes(t.name)} onChange={() => toggle(t.name)} className="m-0 h-4 w-4" />
          <span className="min-w-0 flex-1 truncate">{t.name}</span>
          {t.count > 0 && <span className="text-caption tabular-nums text-muted">{t.count}</span>}
        </label>
      ))}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} className={`link self-start ${rowClass.includes('px-3') ? 'mx-3 my-2' : 'mx-4 my-2 sm:mx-6'} ${COARSE}`}>
          Clear tags
        </button>
      )}
    </div>
  );
}

/** Desktop "Tag ▾" (multi, P7): all chosen tags must match. */
export function TagFilterButton({ tags, selected, onChange }) {
  const [anchor, setAnchor] = useState(null);
  const label = selected.length === 0 ? 'Tag' : selected.length === 1 ? selected[0] : `Tags · ${selected.length}`;
  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        className={`ainput flex w-auto max-w-[10rem] shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap !pb-0.5 text-left ${
          selected.length ? 'weight-up' : ''
        }`}
        data-label={label}
        title={selected.length ? `Tags: ${selected.join(', ')}` : 'Filter by tags'}
      >
        <span className="min-w-0 truncate">{label}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {anchor && (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} align="left" width={240} label="Filter by tags">
          <TagChecklist tags={tags} selected={selected} onChange={onChange} />
        </Popover>
      )}
    </>
  );
}

export function KeySelect({ value, onChange, camelot, className = '', id = 'lib-key' }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={stop}
      aria-label="Key"
      className={`ainput !pb-0.5 ${value ? 'weight-up' : ''} ${TOUCH_TEXT} ${className}`}
    >
      <option value="">Any key</option>
      {KEYS.map((k) => (
        <option key={k} value={k}>
          {formatKey(k, { camelot })}
        </option>
      ))}
    </select>
  );
}

export function SortSelect({ value, onChange, className = '', id = 'lib-sort' }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={stop}
      aria-label="Sort"
      className={`ainput !pb-0.5 ${TOUCH_TEXT} ${className}`}
    >
      {SORT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// The URL gets a plain number: "92,5" from a European keypad -> "92.5".
const toBpmParam = (text) => {
  const n = parseDecimal(text);
  return Number.isFinite(n) ? String(n) : '';
};

// Text with a decimal keypad rather than type=number: that rejects "92,5"
// and turns a wheel over the focused field into a tempo change.
function BpmInput({ value, onCommit, label, id }) {
  const [draft, setDraft, flush] = useDraft(value, (v) => onCommit(toBpmParam(v)), 500);
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
      onBlur={flush}
      onKeyDown={(e) => {
        stop(e);
        if (e.key === 'Enter' && !isComposing(e)) flush();
      }}
      placeholder={label === 'BPM min' ? 'min' : 'max'}
      aria-label={label}
      className={`ainput w-12 !pb-0.5 text-center tabular-nums ${value ? 'weight-up' : ''} ${TOUCH_TEXT}`}
    />
  );
}

export function BpmRange({ min, max, onChange, idPrefix = 'lib' }) {
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <span className="text-caption text-muted">BPM</span>
      <BpmInput id={`${idPrefix}-bpm-min`} value={min} label="BPM min" onCommit={(v) => onChange({ bpmMin: v })} />
      <span className="text-muted">–</span>
      <BpmInput id={`${idPrefix}-bpm-max`} value={max} label="BPM max" onCommit={(v) => onChange({ bpmMax: v })} />
    </span>
  );
}
