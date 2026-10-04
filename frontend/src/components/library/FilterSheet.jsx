import React from 'react';
import TextButton from '../TextButton';
import { BpmRange, KeySelect, SortSelect, TagChecklist } from './Filters';
import { BottomSheet } from './Sheet';
import { SyncControl, ToggleWord } from './Toolbar';
import { COARSE } from './ui';

function Row({ label, children, htmlFor }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 border-b border-line px-4 sm:px-6">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="shrink-0">
          {label}
        </label>
      ) : (
        <span className="shrink-0">{label}</span>
      )}
      <div className="flex min-w-0 items-center justify-end gap-4">{children}</div>
    </div>
  );
}

/**
 * Touch layouts' filter + options sheet: every desktop toolbar control and
 * ⋯ entry, one 44 px row each.
 */
export default function FilterSheet({
  filters,
  onFilters,
  tags,
  camelot,
  setCamelot,
  audition,
  project,
  filtered,
  counts,
  onClear,
  onReanalyzeAll,
  onClose,
}) {
  return (
    <BottomSheet title={filtered ? `Filters · ${counts.matched} of ${counts.total}` : 'Filters'} onClose={onClose}>
      <Row label="Sort" htmlFor="sheet-sort">
        <SortSelect id="sheet-sort" value={filters.sort} onChange={(s) => onFilters({ sort: s })} className="w-40" />
      </Row>
      <Row label="Key" htmlFor="sheet-key">
        <KeySelect id="sheet-key" value={filters.key} onChange={(k) => onFilters({ key: k })} camelot={camelot} className="w-40" />
      </Row>
      <Row label="Tempo">
        <BpmRange idPrefix="sheet" min={filters.bpmMin} max={filters.bpmMax} onChange={onFilters} />
      </Row>
      <div className="border-b border-line">
        <p className="m-0 px-4 pb-1 pt-3 text-caption text-muted sm:px-6">Tags (all must match)</p>
        <TagChecklist
          tags={tags}
          selected={filters.tags}
          onChange={(t) => onFilters({ tags: t })}
          rowClass="min-h-11 px-4 sm:px-6"
        />
      </div>
      {filtered && (
        <div className="flex min-h-11 items-center border-b border-line px-4 sm:px-6">
          <TextButton onClick={onClear} className={COARSE}>
            Clear filters
          </TextButton>
        </div>
      )}
      <p className="m-0 px-4 pb-1 pt-4 text-caption text-muted sm:px-6">Preview</p>
      <Row label="Auto-play on tap">
        <ToggleWord on={audition.auto} onClick={() => audition.setAuto(!audition.auto)}>
          {audition.auto ? 'On' : 'Off'}
        </ToggleWord>
      </Row>
      <Row label="Loop">
        <ToggleWord on={audition.loop} onClick={() => audition.setLoop(!audition.loop)}>
          {audition.loop ? 'On' : 'Off'}
        </ToggleWord>
      </Row>
      <Row label={project ? `Project tempo (${project.name})` : 'Preview tempo'}>
        <SyncControl
          on={audition.sync}
          onToggle={() => audition.setSync(!audition.sync)}
          project={project}
          manualBpm={audition.manualBpm}
          onManualBpm={audition.setManualBpm}
        />
      </Row>
      <Row label="Camelot keys">
        <ToggleWord on={camelot} onClick={() => setCamelot(!camelot)}>
          {camelot ? '8B · C maj' : 'C maj'}
        </ToggleWord>
      </Row>
      <div className="flex min-h-11 items-center px-4 sm:px-6">
        <TextButton onClick={onReanalyzeAll} className={COARSE} title="Detect tempo and key for every sample again">
          Re-analyze all (keeps overrides)
        </TextButton>
      </div>
    </BottomSheet>
  );
}
