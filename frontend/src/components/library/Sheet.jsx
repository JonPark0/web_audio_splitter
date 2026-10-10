import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TextButton from '../TextButton';
import { COARSE } from './ui';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]';

/** Escape closes, focus moves in on open and back to the opener on close. */
function useDialogFocus(ref, onClose) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement;
    const first = ref.current?.querySelector('[data-autofocus]') || ref.current?.querySelector(FOCUSABLE);
    first?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const el = ref.current;
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref]);
}

/**
 * Bottom sheet (tablet/phone inspector, filters, actions): a paper panel
 * from the bottom edge behind a white veil - no shadow, one hairline.
 */
export function BottomSheet({ title, onClose, children, label }) {
  const ref = useRef(null);
  useDialogFocus(ref, onClose);
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-library-overlay>
      <div className="absolute inset-0 bg-paper/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label || title}
        className="relative max-h-[85vh] overflow-y-auto overscroll-contain border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]"
      >
        <div className="sticky top-0 z-10 flex h-12 items-center justify-between gap-4 border-b border-line bg-paper px-4 sm:px-6">
          <h2 className="m-0 min-w-0 truncate text-h4">{title}</h2>
          <TextButton muted onClick={onClose} className={`shrink-0 ${COARSE}`}>
            Close
          </TextButton>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}

/**
 * One action per 44px row (phone action sheet; also the desktop ⋯ menu,
 * compacted). Items: { key, label, onSelect | href (+ download, onClick),
 * disabled, hint }.
 */
export function ActionList({ items, onDone, dense = false }) {
  const row = `flex w-full items-center justify-between gap-4 border-0 bg-transparent text-left text-ink hover:bg-wash focus-visible:bg-wash disabled:text-muted disabled:hover:bg-transparent ${
    dense ? 'min-h-8 px-3 text-p coarse:min-h-11' : 'min-h-11 px-4 sm:px-6'
  }`;
  return (
    <ul className="m-0 list-none p-0" role="menu">
      {items.map((item) => (
        <li key={item.key} role="none" className="border-b border-line last:border-b-0">
          {item.href ? (
            <a
              role="menuitem"
              href={item.href}
              download={item.download}
              className={`${row} no-underline`}
              onClick={(e) => {
                item.onClick?.(e);
                onDone?.();
              }}
            >
              <span className="shrink-0 whitespace-nowrap">{item.label}</span>
              {item.hint && <span className="min-w-0 truncate text-caption text-muted">{item.hint}</span>}
            </a>
          ) : (
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={row}
              onClick={() => {
                onDone?.();
                item.onSelect();
              }}
            >
              <span className="shrink-0 whitespace-nowrap">{item.label}</span>
              {item.hint && <span className="min-w-0 truncate text-caption text-muted">{item.hint}</span>}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Desktop popover anchored to a button rect (⋯ menus, Tag filter): fixed
 * position so the sticky toolbar / scrolling list can't clip it; closes on
 * outside click, Escape and scroll.
 */
export function Popover({ anchor, onClose, children, width = 240, align = 'right', label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useDialogFocus(ref, onClose);

  useLayoutEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = ref.current?.offsetHeight || 0;
    let left = align === 'right' ? anchor.right - width : anchor.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    let top = anchor.bottom + 4;
    if (top + h > vh - 8 && anchor.top - h - 4 > 8) top = anchor.top - h - 4;
    setPos({ left, top });
  }, [anchor, width, align]);

  useEffect(() => {
    const onDown = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onScroll = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    // next tick: the click that opened it mustn't close it
    const t = setTimeout(() => {
      document.addEventListener('pointerdown', onDown);
      window.addEventListener('scroll', onScroll, true);
    });
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      data-library-overlay
      className="fixed z-50 max-h-[70vh] overflow-y-auto border border-line bg-paper"
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {children}
    </div>,
    document.body
  );
}

/** Quiet confirmation at the bottom edge ("Added to QA beat · Open"). */
export function Toast({ toast, onClose, raised = false }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, toast.ms || 6000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return createPortal(
    <div
      role="status"
      className={`fixed left-1/2 z-50 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-baseline gap-4 border border-line bg-paper px-4 py-2 ${
        raised ? 'bottom-[calc(64px+env(safe-area-inset-bottom))]' : 'bottom-4'
      }`}
    >
      <span className="min-w-0 truncate">{toast.message}</span>
      {toast.href && (
        <TextButton as="a" href={toast.href} className="shrink-0">
          {toast.linkLabel || 'Open'}
        </TextButton>
      )}
      <TextButton muted onClick={onClose} className="shrink-0 text-caption">
        Dismiss
      </TextButton>
    </div>,
    document.body
  );
}
