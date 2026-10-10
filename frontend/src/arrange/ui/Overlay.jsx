import React, { useEffect, useRef } from 'react';
import { FiX } from 'react-icons/fi';
import TextButton from '../../components/TextButton';

/** Close on Escape and on a pointer-down outside `ref` (and outside `ignore`). */
export function useDismiss(open, ref, onClose, ignoreRef) {
  const cb = useRef(onClose);
  cb.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cb.current();
      }
    };
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || ignoreRef?.current?.contains(e.target)) return;
      cb.current();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, ref, ignoreRef]);
}

/**
 * Bottom sheet (phone/tablet panels: samples, clip inspector, menus) or a
 * right-hand drawer (`side="right"`, tablet sample browser). Palnarium: paper
 * surface, one hairline edge, no shadow, no backdrop tint.
 */
export function Sheet({ open, title, onClose, side = 'bottom', children, className = '', bodyClassName = '', ignoreRef, maxHeight = '70dvh' }) {
  const ref = useRef(null);
  useDismiss(open, ref, onClose, ignoreRef);
  if (!open) return null;
  const pos =
    side === 'right'
      ? 'right-0 top-[92px] bottom-0 w-[min(340px,90vw)] border-l'
      : 'inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom)]';
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={title}
      className={`fixed z-50 flex flex-col border-line bg-paper ${pos} ${className}`}
      style={side === 'right' ? undefined : { maxHeight }}
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <span className="truncate text-h4">{title}</span>
        <TextButton
          muted
          label=""
          onClick={onClose}
          aria-label={`Close ${title}`}
          className="min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <FiX className="icon" strokeWidth={1.5} aria-hidden="true" />
        </TextButton>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${bodyClassName}`}>{children}</div>
    </div>
  );
}

/**
 * Dropdown menu: a list of actions under (or above) its trigger. Items:
 * { label, onSelect, disabled, checked, hint } | { separator: true } |
 * { content: node } for custom rows. On phones pass `asSheet` and it opens
 * as a bottom sheet instead.
 */
export function Menu({ open, onClose, items, anchorRef, align = 'right', placement = 'down', asSheet = false, title = 'Menu', className = '' }) {
  const ref = useRef(null);
  useDismiss(open && !asSheet, ref, onClose, anchorRef);
  if (!open) return null;

  const list = (
    <ul className="m-0 list-none p-0 py-1">
      {items.filter(Boolean).map((item, i) => {
        if (item.separator) return <li key={`s${i}`} aria-hidden="true" className="my-1 border-t border-line" />;
        if (item.content) return <li key={item.key || `c${i}`} className="px-4 py-1">{item.content}</li>;
        return (
          <li key={item.key || item.label}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              onClick={() => {
                onClose();
                item.onSelect?.();
              }}
              className={`flex min-h-[40px] w-full items-center justify-between gap-6 border-0 bg-transparent px-4 text-left text-ink transition-opacity duration-140 hover:bg-wash disabled:text-muted disabled:hover:bg-transparent coarse:min-h-[44px] ${
                item.checked ? 'weight-up' : ''
              }`}
            >
              <span className="truncate">
                {item.checked !== undefined && <span className="inline-block w-4">{item.checked ? '✓' : ''}</span>}
                {item.label}
              </span>
              {item.hint && <span className="shrink-0 text-caption text-muted">{item.hint}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );

  if (asSheet) {
    return (
      <Sheet open title={title} onClose={onClose} ignoreRef={anchorRef}>
        {list}
      </Sheet>
    );
  }
  return (
    <div
      ref={ref}
      role="menu"
      className={`absolute z-50 min-w-[220px] max-w-[min(360px,92vw)] border border-line bg-paper ${
        align === 'right' ? 'right-0' : 'left-0'
      } ${placement === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} ${className}`}
    >
      {list}
    </div>
  );
}
