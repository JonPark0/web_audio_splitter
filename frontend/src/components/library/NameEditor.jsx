import React, { useEffect, useRef, useState } from 'react';
import { TOUCH_TEXT } from './ui';

/**
 * Rename in place: Enter/blur saves, Escape cancels. Uncontrolled (click
 * the name - the inspector) or controlled via `editing`/`onEditingChange`
 * (a row: Enter key, double-click or the ⋯ menu start it).
 */
export default function NameEditor({ sample, busy, onPatch, editing: editingProp, onEditingChange, size = 'text-h4' }) {
  const controlled = editingProp !== undefined;
  const [editingState, setEditingState] = useState(false);
  const editing = controlled ? editingProp : editingState;
  const setEditing = (v) => (controlled ? onEditingChange?.(v) : setEditingState(v));
  const [draft, setDraft] = useState(sample.name);
  const inputRef = useRef(null);
  // Escape unmounts the input, which fires blur - this stops that blur saving.
  const cancelRef = useRef(false);

  useEffect(() => {
    if (editing) {
      cancelRef.current = false;
      setDraft(sample.name);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = () => {
    setEditing(false);
    if (cancelRef.current) return;
    const next = draft.trim();
    if (next && next !== sample.name) onPatch({ name: next });
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        autoFocus
        maxLength={200}
        aria-label="Sample name"
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep list shortcuts (Space, Del, arrows) out
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
        className={`ainput !pb-0.5 ${size} ${TOUCH_TEXT}`}
      />
    );
  }

  if (controlled) {
    return <span className={`block min-w-0 truncate ${size}`}>{sample.name}</span>;
  }

  // Not TextButton: its centred ghost-label column would break truncation.
  // .weight-hover gives it the link's 300 -> 400 hover without the ghost.
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => setEditing(true)}
      title="Rename"
      className={`weight-hover block w-full min-w-0 cursor-text truncate border-0 bg-transparent p-0 text-left leading-tight text-ink disabled:cursor-default coarse:min-h-11 ${size}`}
    >
      {sample.name}
    </button>
  );
}
