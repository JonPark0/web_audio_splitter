import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FiMoreHorizontal, FiPlus, FiSliders } from 'react-icons/fi';
import { isComposing, parseDecimal } from '../../keys';
import { BPM_MAX, BPM_MIN } from '../../samplesApi';
import TextButton from '../TextButton';
import { BpmRange, KeySelect, SortSelect, TagFilterButton, useDraft } from './Filters';
import { ActionList, Popover } from './Sheet';
import { COARSE, TOUCH_TEXT } from './ui';

/** On/off word: weight + underline when on (colour alone can't carry it). */
export function ToggleWord({ on, onClick, children, title, className = '' }) {
  return (
    <TextButton
      onClick={onClick}
      aria-pressed={on}
      current={on}
      title={title}
      className={`whitespace-nowrap underline-offset-4 ${on ? 'underline decoration-1' : ''} ${COARSE} ${className}`}
    >
      {children}
    </TextButton>
  );
}

/**
 * Tempo typed for Sync without a project. Saved on Enter/blur, not per
 * keystroke: each value restarts the preview and asks the server for a new
 * time-stretched render ("1", "12", "120"...). Text with a decimal keypad,
 * not type=number: European keypads type "92,5", and a wheel over a focused
 * number field changed the tempo while scrolling.
 */
function SyncBpmInput({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  const cancelRef = useRef(false);
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Math.round(parseDecimal(draft) * 100) / 100;
    if (cancelRef.current || !(n >= BPM_MIN && n <= BPM_MAX)) {
      cancelRef.current = false;
      setDraft(String(value));
    } else if (n !== Number(value)) {
      onCommit(n);
    }
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        // Escape with nothing to undo is the filter sheet's (it closes)
        if (e.key === 'Escape' && draft === String(value)) return;
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelRef.current = true;
          e.currentTarget.blur();
        }
      }}
      aria-label="Preview tempo (BPM)"
      className={`ainput w-12 !pb-0.5 text-center tabular-nums ${TOUCH_TEXT}`}
    />
  );
}

/**
 * "Sync": audition at the Arrange project's tempo (time-stretched render).
 * The tempo comes from the last-opened project; with none, a BPM field.
 */
export function SyncControl({ on, onToggle, project, manualBpm, onManualBpm }) {
  const bpm = project?.bpm ?? manualBpm;
  return (
    <span className="flex shrink-0 items-baseline gap-1.5">
      <ToggleWord
        on={on}
        onClick={onToggle}
        title={
          project
            ? `Preview samples at ${project.name}'s ${bpm} BPM (time-stretched)`
            : `Preview samples at ${bpm} BPM (time-stretched)`
        }
      >
        {project ? `Sync ${Math.round(bpm * 100) / 100}` : 'Sync'}
      </ToggleWord>
      {!project && on && <SyncBpmInput value={manualBpm} onCommit={onManualBpm} />}
    </span>
  );
}

function SearchInput({ value, onCommit, placeholder, className = '' }) {
  const [draft, setDraft, flush] = useDraft(value, onCommit, 250);
  return (
    <input
      type="search"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isComposing(e)) return;
        if (e.key === 'Enter') flush();
        if (e.key === 'Escape' && draft) setDraft('');
      }}
      placeholder={placeholder}
      aria-label="Search samples"
      className={`ainput !pb-0.5 ${TOUCH_TEXT} ${className}`}
    />
  );
}

export function CountHeading({ matched, total, filtered, loaded, compact = false, className = '' }) {
  return (
    <h2 className={`m-0 shrink-0 whitespace-nowrap text-h3 font-light ${className}`}>
      <span className={compact ? 'sr-only' : undefined}>Library</span>
      {loaded && (
        <span className={`${compact ? '' : 'ml-2'} tabular-nums`}>{filtered ? `${matched} of ${total}` : total}</span>
      )}
    </h2>
  );
}

/**
 * How many steps a one-line bar must fold (0..max) so that its right-hand
 * group (`endRef`) ends inside it (`barRef`) - nothing clipped, nothing
 * pushing the page sideways. Measured before paint, and again from the
 * full bar whenever its width or `contents` (whatever changes the items'
 * widths) change.
 */
export function useFold(contents, max) {
  const barRef = useRef(null);
  const endRef = useRef(null);
  const [fold, setFold] = useState(0);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!barRef.current) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(barRef.current);
    return () => ro.disconnect();
  }, []);
  const key = `${width}|${contents}`;
  const measuredRef = useRef(key);
  useLayoutEffect(() => {
    if (measuredRef.current !== key) {
      measuredRef.current = key;
      if (fold) {
        setFold(0);
        return;
      }
    }
    const bar = barRef.current?.getBoundingClientRect();
    const end = endRef.current?.getBoundingClientRect();
    if (bar && end && end.right > bar.right + 0.5 && fold < max) setFold(fold + 1);
  });
  return [fold, barRef, endRef];
}

/**
 * The library's one sticky 44 px bar (desktop/tablet): count, search,
 * filters, audition switches, Import and a ⋯ menu. On tablet the filters
 * fold into a sheet behind "Filters" - and on any width where the bar
 * would clip Import or ⋯ (a 1024 px window with filters set, a 768 px
 * tablet), it folds step by step until everything fits: 1 filters behind
 * "Filters" (a sheet), 2 no Sort select, 3 count without "Library" and a
 * narrower search, 4 no Clear - each of those is in the filter sheet too.
 */
export function DesktopToolbar({
  size,
  wide,
  filters,
  onFilters,
  tags,
  counts,
  filtered,
  activeCount,
  onClear,
  camelot,
  audition,
  project,
  onImport,
  moreItems,
  onOpenFilters,
}) {
  const [moreAnchor, setMoreAnchor] = useState(null);
  const desktop = size === 'desktop';

  const [fold, barRef, endRef] = useFold(
    [size, wide, JSON.stringify(filters), JSON.stringify(counts), filtered, audition.sync, project?.name, project?.bpm].join('|'),
    4
  );
  const inline = desktop && fold === 0;

  return (
    <div ref={barRef} className="flex h-11 min-w-0 items-center gap-4 [overflow-x:clip]">
      <CountHeading {...counts} filtered={filtered} compact={fold >= 3} />
      <SearchInput
        value={filters.q}
        onCommit={(v) => onFilters({ q: v })}
        placeholder="Search name, tag, stem"
        className={`${fold >= 3 ? 'min-w-[5rem]' : 'min-w-[8rem]'} max-w-[18rem] flex-1`}
      />
      {inline ? (
        <>
          <TagFilterButton tags={tags} selected={filters.tags} onChange={(t) => onFilters({ tags: t })} />
          <KeySelect value={filters.key} onChange={(k) => onFilters({ key: k })} camelot={camelot} className="w-[7.5rem] shrink-0" />
          <BpmRange min={filters.bpmMin} max={filters.bpmMax} onChange={onFilters} />
          <SortSelect value={filters.sort} onChange={(s) => onFilters({ sort: s })} className="w-[7.5rem] shrink-0 max-[1180px]:hidden" />
        </>
      ) : (
        <>
          <TextButton onClick={onOpenFilters} aria-haspopup="dialog" className={`whitespace-nowrap ${COARSE}`} current={activeCount > 0}>
            {activeCount ? `Filters · ${activeCount}` : 'Filters'}
          </TextButton>
          {fold < 2 && <SortSelect value={filters.sort} onChange={(s) => onFilters({ sort: s })} className="w-[7.5rem] shrink-0" />}
        </>
      )}
      {filtered && fold < 4 && (
        <TextButton muted onClick={onClear} className={`shrink-0 ${COARSE}`}>
          Clear
        </TextButton>
      )}
      <div ref={endRef} className="ml-auto flex shrink-0 items-center gap-4">
        {wide && (
          <>
            <ToggleWord on={audition.auto} onClick={() => audition.setAuto(!audition.auto)} title="Play each sample as you select it (↑ ↓)">
              Auto
            </ToggleWord>
            <ToggleWord on={audition.loop} onClick={() => audition.setLoop(!audition.loop)} title="Loop the preview (L)">
              Loop
            </ToggleWord>
          </>
        )}
        <SyncControl
          on={audition.sync}
          onToggle={() => audition.setSync(!audition.sync)}
          project={project}
          manualBpm={audition.manualBpm}
          onManualBpm={audition.setManualBpm}
        />
        <TextButton onClick={onImport} className={COARSE} title="Import audio files (or drop them anywhere here)">
          Import
        </TextButton>
        <TextButton
          label=""
          aria-label="More library actions"
          aria-haspopup="menu"
          onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)}
          className={`h-8 w-8 justify-center ${COARSE}`}
        >
          <FiMoreHorizontal className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
      </div>
      {moreAnchor && (
        <Popover anchor={moreAnchor} onClose={() => setMoreAnchor(null)} width={280} label="More library actions">
          <ActionList items={moreItems} dense onDone={() => setMoreAnchor(null)} />
        </Popover>
      )}
    </div>
  );
}

/** Phone: one 52 px row - search, Filters (44), Import + (44). */
export function PhoneBar({ filters, onFilters, activeCount, counts, onOpenFilters, onImport }) {
  return (
    <div className="flex h-[52px] items-center gap-1">
      <SearchInput
        value={filters.q}
        onCommit={(v) => onFilters({ q: v })}
        placeholder={counts.loaded ? `Search ${counts.total} samples` : 'Search samples'}
        className="min-w-0 flex-1"
      />
      <TextButton
        label=""
        onClick={onOpenFilters}
        aria-haspopup="dialog"
        aria-label={activeCount ? `Filters and options, ${activeCount} active` : 'Filters and options'}
        current={activeCount > 0}
        className="h-11 min-w-[44px] shrink-0 flex-row items-center justify-center gap-1 px-1"
      >
        <FiSliders className="icon" strokeWidth={1.5} aria-hidden="true" />
        {activeCount > 0 && <span className="text-caption tabular-nums">{activeCount}</span>}
      </TextButton>
      <TextButton
        label=""
        onClick={onImport}
        aria-label="Import audio files"
        className="h-11 w-11 shrink-0 justify-center text-h4"
      >
        <FiPlus className="icon" strokeWidth={1.5} aria-hidden="true" />
      </TextButton>
    </div>
  );
}
