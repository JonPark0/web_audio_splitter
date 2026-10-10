import React, { useId, useState } from 'react';
import { FiMoreHorizontal, FiX } from 'react-icons/fi';
import { isComposing } from '../../keys';
import TextButton from '../TextButton';
import { PlayGlyph } from './SampleRow';
import { ActionList, BottomSheet, Popover } from './Sheet';
import { TagDatalist, parseTags } from './TagEditor';
import { useFold } from './Toolbar';
import { COARSE, TOUCH_TEXT } from './ui';

/**
 * Add tags to / remove tags from every checked sample. Nothing here is
 * disabled while a batch runs (that dropped focus, and the phone keyboard,
 * after each Enter): `onApply` queues behind the running batch.
 */
export function BulkTagPanel({ count, present, allTags, onApply }) {
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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (isComposing(e)) {
              e.stopPropagation();
              return;
            }
            if (e.key === 'Escape') {
              // a draft to drop: drop it; none: let the popover/sheet close
              if (!draft) return;
              setDraft('');
            } else if (e.key === 'Enter') {
              add();
            }
            e.stopPropagation();
          }}
          placeholder="tag, another tag"
          aria-label={`Add tags to ${count} samples`}
          className={`ainput min-w-0 flex-1 !pb-0.5 ${TOUCH_TEXT}`}
        />
        <TagDatalist id={listId} tags={allTags} />
        <TextButton disabled={!draft.trim()} onClick={add} className={COARSE}>
          Add
        </TextButton>
      </div>
      {present.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
          <span className="text-muted">Remove</span>
          {present.map((t) => (
            <TextButton key={t} onClick={() => onApply({ remove: [t] })} className={COARSE} title={`Remove "${t}" from all ${count}`}>
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
      <TextButton disabled={busy} onClick={onConfirm} className={COARSE}>
        Confirm
      </TextButton>
      {/* focus on Cancel: Enter/Space right after Delete mustn't confirm */}
      <TextButton autoFocus muted disabled={busy} onClick={onCancel} className={COARSE}>
        Cancel
      </TextButton>
    </span>
  );
}

/**
 * Bulk actions (P5) for the checked samples. Desktop/tablet: takes over the
 * sticky toolbar row. Phone: the screen's one bottom bar - it replaces the
 * now-playing bar, so it carries that bar's stop (`playing`: { sample,
 * loading, onStop }); selecting used to leave no way to stop a preview.
 */
export default function BulkBar({ phone, count, matched, allMatched, onSelectAllMatched, onClear, onReanalyze, onZip, onDelete, tagPanel, busy, progress, playing }) {
  const [tagAnchor, setTagAnchor] = useState(null);
  const [moreAnchor, setMoreAnchor] = useState(null);
  const [asking, setAsking] = useState(false);
  const [sheet, setSheet] = useState(null); // 'tags' | 'more'
  // The toolbar row folds to fit a narrow tablet / window (it pushed the
  // page sideways at 640 px): 1 Re-analyze and Download ZIP into a ⋯ menu,
  // 2 "Select all" too, 3 the count without "selected".
  const [fold, barRef, endRef] = useFold(`${count}|${matched}|${allMatched}|${asking}|${!!progress}`, 3);

  const selectAll = !allMatched && matched > count && (
    <TextButton onClick={onSelectAllMatched} disabled={busy} className={`whitespace-nowrap ${COARSE}`}>
      {`Select all ${matched}`}
    </TextButton>
  );

  if (phone) {
    return (
      <>
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]">
          <div className="px-safe flex h-14 items-center gap-3">
            {asking ? (
              <DeleteAsk count={count} busy={busy} onCancel={() => setAsking(false)} onConfirm={() => (setAsking(false), onDelete())} />
            ) : (
              <>
                <TextButton label="" aria-label="Stop selecting" onClick={onClear} className="-ml-2.5 h-11 w-11 shrink-0 justify-center">
                  <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
                </TextButton>
                {playing && (
                  <TextButton
                    label=""
                    onClick={playing.onStop}
                    aria-label={`Stop ${playing.sample.name}`}
                    current
                    className="h-11 w-11 shrink-0 justify-center text-h4"
                  >
                    <PlayGlyph playing loading={playing.loading} />
                  </TextButton>
                )}
                <span className="min-w-0 flex-1 truncate tabular-nums" aria-live="polite">
                  {progress || (count ? `${count} selected` : 'Tap samples to select')}
                </span>
                <TextButton disabled={busy || !count} onClick={() => setSheet('tags')} className={COARSE}>
                  Tag
                </TextButton>
                <TextButton disabled={busy || !count} onClick={() => setAsking(true)} className={COARSE}>
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
                { key: 'zip', label: 'Download ZIP', onSelect: onZip, disabled: busy || !count },
                { key: 'an', label: 'Re-analyze', hint: 'keeps your BPM/key', onSelect: onReanalyze, disabled: busy || !count },
                { key: 'clear', label: 'Clear selection', onSelect: onClear },
              ]}
            />
          </BottomSheet>
        )}
      </>
    );
  }

  return (
    <div ref={barRef} className="flex h-11 min-w-0 items-center gap-5 [overflow-x:clip]">
      <span className="shrink-0 whitespace-nowrap text-h3 font-light tabular-nums" aria-live="polite">
        {count}
        <span className={fold >= 3 ? 'sr-only' : undefined}> selected</span>
      </span>
      {fold < 2 && selectAll}
      {asking ? (
        <DeleteAsk count={count} busy={busy} onCancel={() => setAsking(false)} onConfirm={() => (setAsking(false), onDelete())} />
      ) : (
        <>
          {/* not disabled while busy: tag changes queue behind the batch */}
          <TextButton
            aria-haspopup="dialog"
            onClick={(e) => setTagAnchor(tagAnchor ? null : e.currentTarget)}
            className={COARSE}
          >
            Tag…
          </TextButton>
          {fold < 1 && (
            <>
              <TextButton disabled={busy} onClick={onReanalyze} className={COARSE} title="Detect tempo and key again; your overrides are kept">
                Re-analyze
              </TextButton>
              <TextButton disabled={busy} onClick={onZip} className={`whitespace-nowrap ${COARSE}`}>
                Download ZIP
              </TextButton>
            </>
          )}
          <TextButton disabled={busy} onClick={() => setAsking(true)} className={COARSE}>
            Delete
          </TextButton>
          {fold >= 1 && (
            <TextButton
              label=""
              aria-label="More bulk actions"
              aria-haspopup="menu"
              onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)}
              className={`h-8 w-8 shrink-0 justify-center ${COARSE}`}
            >
              <FiMoreHorizontal className="icon" strokeWidth={1.5} aria-hidden="true" />
            </TextButton>
          )}
        </>
      )}
      {progress && <span className="min-w-0 truncate text-caption text-muted">{progress}</span>}
      <span ref={endRef} className="ml-auto shrink-0">
        <TextButton muted onClick={onClear} className={`whitespace-nowrap ${COARSE}`} title="Esc">
          Clear selection
        </TextButton>
      </span>
      {moreAnchor && (
        <Popover anchor={moreAnchor} onClose={() => setMoreAnchor(null)} width={260} label="More bulk actions">
          <ActionList
            dense
            onDone={() => setMoreAnchor(null)}
            items={[
              ...(fold >= 2 && selectAll ? [{ key: 'all', label: `Select all ${matched}`, onSelect: onSelectAllMatched, disabled: busy }] : []),
              { key: 'an', label: 'Re-analyze', hint: 'keeps your BPM/key', onSelect: onReanalyze, disabled: busy },
              { key: 'zip', label: 'Download ZIP', onSelect: onZip, disabled: busy },
            ]}
          />
        </Popover>
      )}
      {tagAnchor && (
        <Popover anchor={tagAnchor} onClose={() => setTagAnchor(null)} align="left" width={320} label={`Tags for ${count} samples`}>
          {tagPanel}
        </Popover>
      )}
    </div>
  );
}
