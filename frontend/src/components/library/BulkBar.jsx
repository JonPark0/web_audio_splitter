import React, { useId, useState } from 'react';
import { FiMoreHorizontal } from 'react-icons/fi';
import TextButton from '../TextButton';
import { ActionList, BottomSheet, Popover } from './Sheet';
import { TagDatalist, parseTags } from './TagEditor';
import { COARSE, TOUCH_TEXT } from './ui';

/** Add tags to / remove tags from every checked sample. */
export function BulkTagPanel({ count, present, allTags, onApply, busy }) {
  const [draft, setDraft] = useState('');
  const listId = useId();
  const add = () => {
    const tags = parseTags(draft);
    if (!tags.length) return;
    setDraft('');
    onApply({ add: tags });
  };
  return (
    <div className="flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-baseline gap-3">
        <input
          type="text"
          value={draft}
          list={listId}
          data-autofocus
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') add();
          }}
          placeholder="tag, another tag"
          aria-label={`Add tags to ${count} samples`}
          className={`ainput min-w-0 flex-1 !pb-0.5 ${TOUCH_TEXT}`}
        />
        <TagDatalist id={listId} tags={allTags} />
        <TextButton disabled={busy || !draft.trim()} onClick={add} className={COARSE}>
          Add
        </TextButton>
      </div>
      {present.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
          <span className="text-muted">Remove</span>
          {present.map((t) => (
            <TextButton key={t} disabled={busy} onClick={() => onApply({ remove: [t] })} className={COARSE} title={`Remove "${t}" from all ${count}`}>
              {`${t} ×`}
            </TextButton>
          ))}
        </div>
      )}
    </div>
  );
}

function DeleteAsk({ count, onConfirm, onCancel, busy }) {
  return (
    <span className="inline-flex items-baseline gap-3" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <span className="whitespace-nowrap">Delete {count}?</span>
      <TextButton autoFocus disabled={busy} onClick={onConfirm} className={COARSE}>
        Confirm
      </TextButton>
      <TextButton muted disabled={busy} onClick={onCancel} className={COARSE}>
        Cancel
      </TextButton>
    </span>
  );
}

/**
 * Bulk actions (P5) for the checked samples. Desktop/tablet: takes over the
 * sticky toolbar row. Phone: the screen's one bottom bar.
 */
export default function BulkBar({ phone, count, matched, allMatched, onSelectAllMatched, onClear, onReanalyze, onZip, onDelete, tagPanel, busy, progress }) {
  const [tagAnchor, setTagAnchor] = useState(null);
  const [asking, setAsking] = useState(false);
  const [sheet, setSheet] = useState(null); // 'tags' | 'more'

  const selectAll = !allMatched && matched > count && (
    <TextButton onClick={onSelectAllMatched} disabled={busy} className={`whitespace-nowrap ${COARSE}`}>
      {`Select all ${matched}`}
    </TextButton>
  );

  if (phone) {
    return (
      <>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]">
          <div className="flex h-14 items-center gap-3 px-4">
            {asking ? (
              <DeleteAsk count={count} busy={busy} onCancel={() => setAsking(false)} onConfirm={() => (setAsking(false), onDelete())} />
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate tabular-nums" aria-live="polite">
                  {progress || `${count} selected`}
                </span>
                <TextButton disabled={busy} onClick={() => setSheet('tags')} className={COARSE}>
                  Tag
                </TextButton>
                <TextButton disabled={busy} onClick={() => setAsking(true)} className={COARSE}>
                  Delete
                </TextButton>
                <TextButton label="" aria-label="More bulk actions" onClick={() => setSheet('more')} className="h-11 w-11 justify-center text-h4">
                  <FiMoreHorizontal className="icon" strokeWidth={1.5} aria-hidden="true" />
                </TextButton>
              </>
            )}
          </div>
        </div>
        {sheet === 'tags' && (
          <BottomSheet title={`Tags for ${count} samples`} onClose={() => setSheet(null)}>
            {tagPanel}
          </BottomSheet>
        )}
        {sheet === 'more' && (
          <BottomSheet title={`${count} selected`} onClose={() => setSheet(null)}>
            <ActionList
              onDone={() => setSheet(null)}
              items={[
                ...(!allMatched && matched > count ? [{ key: 'all', label: `Select all ${matched} matched`, onSelect: onSelectAllMatched }] : []),
                { key: 'zip', label: 'Download ZIP', onSelect: onZip, disabled: busy },
                { key: 'an', label: 'Re-analyze', hint: 'keeps your BPM/key', onSelect: onReanalyze, disabled: busy },
                { key: 'clear', label: 'Clear selection', onSelect: onClear },
              ]}
            />
          </BottomSheet>
        )}
      </>
    );
  }

  return (
    <div className="flex h-11 items-center gap-5">
      <span className="shrink-0 whitespace-nowrap text-h3 font-light tabular-nums" aria-live="polite">
        {count} selected
      </span>
      {selectAll}
      {asking ? (
        <DeleteAsk count={count} busy={busy} onCancel={() => setAsking(false)} onConfirm={() => (setAsking(false), onDelete())} />
      ) : (
        <>
          <TextButton
            disabled={busy}
            aria-haspopup="dialog"
            onClick={(e) => setTagAnchor(tagAnchor ? null : e.currentTarget.getBoundingClientRect())}
            className={COARSE}
          >
            Tag…
          </TextButton>
          <TextButton disabled={busy} onClick={onReanalyze} className={COARSE} title="Detect tempo and key again; your overrides are kept">
            Re-analyze
          </TextButton>
          <TextButton disabled={busy} onClick={onZip} className={`whitespace-nowrap ${COARSE}`}>
            Download ZIP
          </TextButton>
          <TextButton disabled={busy} onClick={() => setAsking(true)} className={COARSE}>
            Delete
          </TextButton>
        </>
      )}
      {progress && <span className="min-w-0 truncate text-caption text-muted">{progress}</span>}
      <TextButton muted onClick={onClear} className={`ml-auto shrink-0 whitespace-nowrap ${COARSE}`} title="Esc">
        Clear selection
      </TextButton>
      {tagAnchor && (
        <Popover anchor={tagAnchor} onClose={() => setTagAnchor(null)} align="left" width={320} label={`Tags for ${count} samples`}>
          {tagPanel}
        </Popover>
      )}
    </div>
  );
}
