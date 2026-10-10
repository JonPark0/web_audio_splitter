import React, { useEffect, useId, useRef, useState } from 'react';
import { FiX } from 'react-icons/fi';
import { isComposing } from '../../keys';
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
 *
 * The field stays enabled while a save runs: disabling it dropped focus
 * after every Enter (closing a phone's keyboard, losing what was typed
 * next). Changes queue instead, each one built on the tags the previous
 * one wrote, and the chips show that pending list until the last returns.
 * Mount it with key={sample.id}: the queue belongs to one sample.
 */
export default function TagEditor({ sample, onPatch, allTags = [] }) {
  const [pending, setPending] = useState(null); // tags while saves are queued
  const tags = pending || sample.tags || [];
  const [draft, setDraft] = useState('');
  const listId = useId();
  const queueRef = useRef({ tail: Promise.resolve(), count: 0, tags: null });

  const save = (next) => {
    const q = queueRef.current;
    q.tags = next;
    q.count += 1;
    setPending(next);
    q.tail = q.tail
      .then(() => onPatch({ tags: next }))
      .finally(() => {
        q.count -= 1;
        if (!q.count) {
          q.tags = null;
          setPending(null); // the server's list (or the old one, if it failed)
        }
      });
  };

  const addFrom = (text) => {
    // Commas split so a pasted "drums, loop" becomes two tags.
    const current = queueRef.current.tags || sample.tags || [];
    const fresh = parseTags(text).filter((t) => !current.includes(t));
    if (fresh.length) save([...current, ...fresh]);
  };

  const add = () => {
    setDraft('');
    addFrom(draft);
  };

  const remove = (tag) => save((queueRef.current.tags || sample.tags || []).filter((t) => t !== tag));

  // Unmounted mid-word (sheet closed with the field still focused - a tap on
  // iOS doesn't blur it - or the inspector swapped for a sheet at 1280 px):
  // keep the word. (A field still in the page is StrictMode's rehearsal.)
  const fieldRef = useRef(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const addFromRef = useRef(addFrom);
  addFromRef.current = addFrom;
  useEffect(
    () => () => {
      if (!fieldRef.current?.isConnected && draftRef.current.trim()) addFromRef.current(draftRef.current);
    },
    []
  );

  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-4 gap-y-1">
      <span className="w-10 shrink-0 text-caption text-muted">Tags</span>
      {tags.map((tag) => (
        <span key={tag} className="inline-flex min-w-0 items-center gap-0.5">
          <span className="truncate">{tag}</span>
          <button
            type="button"
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
        ref={fieldRef}
        type="text"
        value={draft}
        list={listId}
        placeholder="Add tag"
        aria-label={`Add tag to ${sample.name}`}
        onChange={(e) => {
          const v = e.target.value;
          // a typed comma commits what's before it
          if (v.endsWith(',')) {
            setDraft('');
            addFrom(v);
          } else {
            setDraft(v);
          }
        }}
        onBlur={add}
        onKeyDown={(e) => {
          // The Enter/Escape that ends an IME composition belongs to the IME
          // (committing here split "드럼" into "드럼" + "럼").
          if (isComposing(e)) {
            e.stopPropagation();
            return;
          }
          if (e.key === 'Escape') {
            // a draft to drop: drop it; none: let the sheet close
            if (!draft) return;
            setDraft('');
          } else if (e.key === 'Enter') {
            e.preventDefault();
            add();
          }
          e.stopPropagation();
        }}
        className={`ainput w-28 !pb-0.5 ${TOUCH_TEXT}`}
      />
      <TagDatalist id={listId} tags={allTags.filter((t) => !tags.includes(t.name))} />
    </div>
  );
}
