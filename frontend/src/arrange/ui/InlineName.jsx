import React, { useEffect, useRef, useState } from 'react';

/**
 * Click-to-rename text (same behaviour as the library NameEditor): Enter or
 * blur commits, Escape cancels, blank reverts.
 */
export default function InlineName({ value, onCommit, label, className = '', inputClassName = '' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);
  const cancelRef = useRef(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  // Runs once per edit: Enter/Escape finish directly (blur() doesn't always
  // dispatch focus events), and the blur that follows is then ignored.
  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setEditing(false);
    if (cancelRef.current) return;
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        autoFocus
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            cancelRef.current = e.key === 'Escape';
            finish();
          }
        }}
        className={`ainput !pb-0.5 ${inputClassName}`}
      />
    );
  }

  // Not TextButton: its centred ghost-label column would break truncation.
  return (
    <button
      type="button"
      onClick={() => {
        cancelRef.current = false;
        doneRef.current = false;
        setDraft(value);
        setEditing(true);
      }}
      title="Rename"
      className={`block min-w-0 cursor-text truncate border-0 bg-transparent p-0 text-left leading-tight text-ink ${className}`}
    >
      {value}
    </button>
  );
}
