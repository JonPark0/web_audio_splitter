import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { isComposing } from '../../keys';

/**
 * Click-to-rename text (same behaviour as the library NameEditor): Enter or
 * blur commits, Escape cancels, blank reverts.
 *
 * `armed`: whether a tap renames. A finger tap on a name that isn't armed
 * (the track isn't selected yet) only selects, so scrolling past or picking
 * a track doesn't throw up the keyboard; mouse clicks always rename. The ref
 * exposes `edit()` for an explicit Rename action.
 */
export default forwardRef(function InlineName({ value, onCommit, label, className = '', inputClassName = '', armed = true }, ref) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);
  const cancelRef = useRef(false);
  const doneRef = useRef(false);
  const blockedRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const start = () => {
    cancelRef.current = false;
    doneRef.current = false;
    setDraft(value);
    setEditing(true);
  };
  useImperativeHandle(ref, () => ({ edit: start }));

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
  // Removed while editing (its sheet closed by a tap outside): keep the name.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  useEffect(() => () => editingRef.current && finishRef.current(), []);

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        autoFocus
        enterKeyHint="done"
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' && !isComposing(e)) || e.key === 'Escape') {
            cancelRef.current = e.key === 'Escape';
            finish();
          }
        }}
        className={`ainput !pb-1 coarse:min-h-[44px] coarse:text-p ${inputClassName}`}
      />
    );
  }

  // Not TextButton: its centred ghost-label column would break truncation.
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        blockedRef.current = !armed && e.pointerType === 'touch';
      }}
      onClick={() => {
        if (blockedRef.current) {
          blockedRef.current = false;
          return;
        }
        start();
      }}
      title={armed ? 'Rename' : 'Rename (tap again)'}
      className={`weight-hover block min-w-0 cursor-text truncate border-0 bg-transparent p-0 text-left leading-tight text-ink ${className}`}
    >
      {value}
    </button>
  );
});
