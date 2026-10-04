import React, { useId, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { COARSE, TOUCH_TEXT } from './ui';

// Lower-cased and space-collapsed so "Drums" and "drums " filter as one tag.
export const normalizeTag = (t) => t.trim().replace(/\s+/g, ' ').toLowerCase();

export function parseTags(text) {
  return [...new Set(text.split(',').map(normalizeTag).filter(Boolean))];
}

/** <datalist> of the library's tags, for suggestion-as-you-type (B7). */
export function TagDatalist({ id, tags }) {
  return (
    <datalist id={id}>
      {tags.map((t) => (
        <option key={t.name} value={t.name} />
      ))}
    </datalist>
  );
}

/**
 * Tag chips (plain words, × to remove) plus an input that adds on Enter,
 * comma or blur (B7: tags typed then clicked away from used to be lost),
 * suggesting the library's existing tags.
 */
export default function TagEditor({ sample, busy, onPatch, allTags = [] }) {
  const tags = sample.tags || [];
  const [draft, setDraft] = useState('');
  const listId = useId();

  const add = () => {
    // Commas split so a pasted "drums, loop" becomes two tags.
    const fresh = parseTags(draft).filter((t) => !tags.includes(t));
    setDraft('');
    if (fresh.length) onPatch({ tags: [...tags, ...fresh] });
  };

  const remove = (tag) => onPatch({ tags: tags.filter((t) => t !== tag) });

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="w-10 shrink-0 text-caption text-muted">Tags</span>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex min-w-0 items-center gap-0.5">
          <span className="truncate">{tag}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => remove(tag)}
            aria-label={`Remove tag ${tag}`}
            title="Remove tag"
            className={`link ${COARSE}`}
          >
            <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        disabled={busy}
        list={listId}
        placeholder="Add tag"
        aria-label={`Add tag to ${sample.name}`}
        onChange={(e) => {
          const v = e.target.value;
          // a typed comma commits what's before it
          if (v.endsWith(',')) {
            const fresh = parseTags(v).filter((t) => !tags.includes(t));
            setDraft('');
            if (fresh.length) onPatch({ tags: [...tags, ...fresh] });
          } else {
            setDraft(v);
          }
        }}
        onBlur={add}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          } else if (e.key === 'Escape') {
            setDraft('');
          }
        }}
        className={`ainput w-28 !pb-0.5 ${TOUCH_TEXT}`}
      />
      <TagDatalist id={listId} tags={allTags.filter((t) => !tags.includes(t.name))} />
    </div>
  );
}
