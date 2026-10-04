import React, { useState } from 'react';
import { FiCheckSquare, FiMoreHorizontal, FiPlus, FiSliders } from 'react-icons/fi';
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
      {!project && on && (
        <input
          type="number"
          inputMode="decimal"
          min="20"
          max="999"
          value={manualBpm}
          onChange={(e) => onManualBpm(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Preview tempo (BPM)"
          className={`ainput w-12 !pb-0.5 text-center tabular-nums ${TOUCH_TEXT}`}
        />
      )}
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
        if (e.key === 'Enter') flush();
        if (e.key === 'Escape' && draft) setDraft('');
      }}
      placeholder={placeholder}
      aria-label="Search samples"
      className={`ainput !pb-0.5 ${TOUCH_TEXT} ${className}`}
    />
  );
}

export function CountHeading({ matched, total, filtered, loaded, className = '' }) {
  return (
    <h2 className={`m-0 shrink-0 whitespace-nowrap text-h3 font-light ${className}`}>
      Library
      {loaded && (
        <span className="ml-2 tabular-nums">{filtered ? `${matched} of ${total}` : total}</span>
      )}
    </h2>
  );
}

/**
 * The library's one sticky 44 px bar (desktop/tablet): count, search,
 * filters, audition switches, Import and a ⋯ menu. On tablet the filters
 * fold into a sheet behind "Filters".
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
  return (
    <div className="flex h-11 min-w-0 items-center gap-4 [overflow-x:clip]">
      <CountHeading {...counts} filtered={filtered} />
      <SearchInput
        value={filters.q}
        onCommit={(v) => onFilters({ q: v })}
        placeholder="Search name, tag, stem"
        className="min-w-[8rem] max-w-[18rem] flex-1"
      />
      {desktop ? (
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
          <SortSelect value={filters.sort} onChange={(s) => onFilters({ sort: s })} className="w-[7.5rem] shrink-0" />
        </>
      )}
      {filtered && (
        <TextButton muted onClick={onClear} className={`shrink-0 ${COARSE}`}>
          Clear
        </TextButton>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-4">
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
          onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget.getBoundingClientRect())}
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
export function PhoneBar({ filters, onFilters, activeCount, counts, onOpenFilters, onImport, onSelect }) {
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
        onClick={onSelect}
        disabled={!counts.loaded}
        aria-label="Select samples"
        className="h-11 w-11 shrink-0 justify-center text-h4"
      >
        <FiCheckSquare className="icon" strokeWidth={1.5} aria-hidden="true" />
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
