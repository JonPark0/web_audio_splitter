import React, { useState } from 'react';
import { FiX } from 'react-icons/fi';

// Lower-cased and space-collapsed so "Drums" and "drums " filter as one tag.
const normalize = (t) => t.trim().replace(/\s+/g, ' ').toLowerCase();

/** Tag chips (plain words, x to remove) plus an input that adds on Enter. */
export default function TagEditor({ sample, busy, onPatch }) {
  const tags = sample.tags || [];
  const [draft, setDraft] = useState('');

  const add = () => {
    // Commas split so a pasted "drums, loop" becomes two tags.
    const fresh = draft.split(',').map(normalize).filter((t) => t && !tags.includes(t));
    setDraft('');
    if (fresh.length) onPatch({ tags: [...tags, ...new Set(fresh)] });
  };

  const remove = (tag) => onPatch({ tags: tags.filter((t) => t !== tag) });

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-2 text-caption">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex min-w-0 items-center gap-1">
          <span className="truncate">{tag}</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => remove(tag)}
            aria-label={`Remove tag ${tag}`}
            title="Remove tag"
            className="link link--muted"
          >
            <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
          </button>
        </span>
      ))}
      <input
        type="text"
        value={draft}
        disabled={busy}
        placeholder="Add tag"
        aria-label={`Add tag to ${sample.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add();
          } else if (e.key === 'Escape') {
            setDraft('');
          }
        }}
        className="ainput w-24 !pb-1"
      />
    </div>
  );
}
