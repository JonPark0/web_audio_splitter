import React, { useEffect, useRef, useState } from 'react';
import TextButton from '../../components/TextButton';
import { isComposing, parseDecimal } from '../../keys';

/** A typed number: decimal comma (European keypads) and '−' accepted; null if not one. */
export function parseNumber(text) {
  const n = parseDecimal(String(text ?? '').replace(/^−/, '-'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Text-entry number/label field: Enter or blur commits through `parse`
 * (return null to reject), Escape or bad input reverts. Never fights the
 * user while focused: outside updates apply only when it isn't.
 */
export function CommitField({
  value,
  format = (v) => (v == null ? '' : String(v)),
  parse = parseNumber,
  onCommit,
  label,
  inputMode = 'decimal',
  className = '',
  placeholder = '—',
  title,
  disabled,
}) {
  const shown = format(value);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  const cancel = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  const commit = () => {
    if (!focused.current) return;
    focused.current = false;
    const parsed = cancel.current || draft.trim() === '' ? null : parse(draft.trim());
    cancel.current = false;
    if (parsed === null || parsed === undefined) {
      setDraft(shown);
      return;
    }
    setDraft(format(parsed));
    if (format(parsed) !== shown) onCommit(parsed);
  };
  // A sheet closed by a tap outside unmounts the field before it blurs:
  // keep what was typed.
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => commitRef.current(), []);

  return (
    <input
      type="text"
      inputMode={inputMode}
      enterKeyHint="done"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      title={title}
      onFocus={(e) => {
        focused.current = true;
        e.target.select();
      }}
      onChange={(e) => {
        focused.current = true;
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation(); // typing never triggers timeline shortcuts
        if ((e.key === 'Enter' && !isComposing(e)) || e.key === 'Escape') {
          cancel.current = e.key === 'Escape';
          commit();
          e.currentTarget.blur();
        }
      }}
      aria-label={label}
      className={`ainput !pb-0.5 tabular-nums coarse:min-h-[44px] coarse:text-p ${className}`}
    />
  );
}

/**
 * A slider's value readout that resets the slider when tapped: double-click
 * needs a mouse, and a 9 px thumb is hard to land exactly on 0 dB / centre.
 */
export function ResetValue({ onReset, label, children, className = '' }) {
  return (
    <TextButton
      onClick={onReset}
      aria-label={label}
      title={label}
      label={typeof children === 'string' ? children : undefined}
      className={`shrink-0 items-end tabular-nums text-caption ${className}`}
    >
      {children}
    </TextButton>
  );
}

/** Caption label above a control group (its row wraps on a narrow sheet). */
export function Group({ label, children, className = '', title }) {
  return (
    <div className={`flex min-w-0 flex-col ${className}`} title={title}>
      <span className="truncate text-caption leading-tight text-muted">{label}</span>
      <div className="flex min-h-[28px] min-w-0 flex-wrap items-center gap-x-2 coarse:min-h-[44px]">{children}</div>
    </div>
  );
}
