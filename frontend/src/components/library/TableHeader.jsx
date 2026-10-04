import React, { useEffect, useRef } from 'react';
import { GRID } from './SampleRow';

// Column → [ascending, descending] backend sort keys.
const SORTS = {
  name: ['name', '-name'],
  duration: ['duration', '-duration'],
  bpm: ['bpm', '-bpm'],
  key: ['key', 'key'],
};

function SortButton({ column, sort, onSort, children, align = 'left' }) {
  const [asc, desc] = SORTS[column];
  const active = sort === asc || sort === desc;
  const dir = !active ? null : sort === desc && asc !== desc ? 'descending' : 'ascending';
  const next = !active ? asc : sort === asc && asc !== desc ? desc : asc;
  return (
    <div role="columnheader" aria-sort={dir || 'none'} className={`pr-3 ${align === 'right' ? 'text-right' : ''}`}>
      <button
        type="button"
        onClick={() => onSort(next)}
        title={`Sort by ${String(children).toLowerCase()}`}
        className={`link text-caption [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 [@media(pointer:coarse)]:justify-center ${active ? 'is-current' : ''} ${align === 'right' ? 'items-end' : 'items-start'}`}
        data-label={`${children} ↓`}
      >
        <span>
          {children}
          {dir === 'ascending' ? ' ↑' : dir === 'descending' ? ' ↓' : ''}
        </span>
      </button>
    </div>
  );
}

/**
 * Sticky column header under the toolbar: sortable columns (P8) and a
 * tri-state "check all loaded" box.
 */
export default function TableHeader({ size, sort, onSort, checkState, onCheckAll, top }) {
  const boxRef = useRef(null);
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = checkState === 'some';
  }, [checkState]);
  const tablet = size === 'tablet';
  return (
    <div
      role="row"
      className={`sticky z-10 grid ${GRID[size]} h-8 items-center border-b border-line bg-paper [@media(pointer:coarse)]:h-11`}
      style={{ top }}
    >
      <label role="columnheader" className="flex h-full cursor-pointer items-center justify-center">
        <input
          ref={boxRef}
          type="checkbox"
          checked={checkState === 'all'}
          onChange={onCheckAll}
          aria-label="Select all loaded samples"
          className={`m-0 cursor-pointer ${tablet ? 'h-5 w-5' : 'h-3.5 w-3.5'}`}
        />
      </label>
      {/* sr-only text inside a cell: an sr-only cell itself would leave the grid flow */}
      <div role="columnheader">
        <span className="sr-only">Play</span>
      </div>
      <div role="columnheader">
        <span className="sr-only">Waveform</span>
      </div>
      <SortButton column="name" sort={sort} onSort={onSort}>
        Name
      </SortButton>
      {!tablet && (
        <SortButton column="duration" sort={sort} onSort={onSort} align="right">
          Length
        </SortButton>
      )}
      <SortButton column="bpm" sort={sort} onSort={onSort} align="right">
        BPM
      </SortButton>
      <SortButton column="key" sort={sort} onSort={onSort}>
        Key
      </SortButton>
      {!tablet && (
        <div role="columnheader" className="text-caption text-muted">
          Tags
        </div>
      )}
      <div role="columnheader">
        <span className="sr-only">Actions</span>
      </div>
    </div>
  );
}
