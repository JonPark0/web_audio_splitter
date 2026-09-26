import React, { useEffect, useRef, useState } from 'react';

/** Inline rename: click the name, Enter/blur saves, Escape cancels. */
export default function NameEditor({ sample, busy, onPatch }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(sample.name);
  const inputRef = useRef(null);
  // Escape unmounts the input, which fires blur - this stops that blur saving.
  const cancelRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    cancelRef.current = false;
    setDraft(sample.name);
    setEditing(true);
  };

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
        aria-label="Sample name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            cancelRef.current = true;
            e.currentTarget.blur();
          }
        }}
        className="ainput text-h4 !pb-1"
      />
    );
  }

  // Not TextButton: its centred ghost-label column would break truncation.
  // .weight-hover gives it the link's 300 -> 400 hover without the ghost.
  return (
    <button
      type="button"
      disabled={busy}
      onClick={start}
      title="Rename"
      className="weight-hover block w-full min-w-0 cursor-text truncate border-0 bg-transparent p-0 text-left text-h4 leading-tight text-ink disabled:cursor-default"
    >
      {sample.name}
    </button>
  );
}
