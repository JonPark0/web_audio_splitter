import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isComposing, isTextEntry } from '../../keys';
import TextButton from '../TextButton';
import { COARSE } from './ui';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex="0"]';

// Open dialogs, innermost last: Escape and Tab belong to the top one.
const openDialogs = [];

/**
 * Escape closes, focus moves in on open and back to the opener on close;
 * `modal` also keeps Tab inside. Escape is heard on the whole document (a
 * tap on the veil leaves focus on <body>), but only after the focused
 * field: one that cancels its own edit on Escape (name, BPM, a tag draft)
 * stops the event there, so the first Escape cancels the edit and the
 * next one closes.
 */
function useDialogFocus(ref, onClose, { opener: openerEl, focusSelf = false, modal = false } = {}) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const el = ref.current;
    const opener = openerEl || document.activeElement;
    openDialogs.push(el);
    const first = el?.querySelector('[data-autofocus]') || (focusSelf ? el : el?.querySelector(FOCUSABLE));
    first?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (!el || openDialogs[openDialogs.length - 1] !== el || e.defaultPrevented || isComposing(e)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab' && modal) {
        const items = [...el.querySelectorAll(FOCUSABLE)].filter((n) => n.getClientRects().length);
        if (!items.length) return;
        const a = document.activeElement;
        const edge = e.shiftKey ? a === items[0] || a === el : a === items[items.length - 1];
        if (edge || !el.contains(a)) {
          e.preventDefault();
          (e.shiftKey ? items[items.length - 1] : items[0]).focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openDialogs.splice(openDialogs.indexOf(el), 1);
      // Only when focus went down with the dialog. An action that moved it
      // on keeps it: ⋯ → Rename used to lose its new field to this (blur
      // ends a rename), so the rename closed as it opened.
      const a = document.activeElement;
      const lost = !a || a === document.body || el?.contains(a);
      if (lost && opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [ref]); // eslint-disable-line react-hooks/exhaustive-deps
}

// The page behind a sheet stays put: dragging the veil used to scroll the
// list (and fire its infinite scroll) underneath. Counted, for stacked sheets.
let locks = 0;
let savedOverflow = '';
function useScrollLock() {
  useEffect(() => {
    const root = document.documentElement;
    if (locks++ === 0) {
      savedOverflow = root.style.overflow;
      root.style.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0) root.style.overflow = savedOverflow;
    };
  }, []);
}

/**
 * The on-screen keyboard's height while a field in the sheet has focus.
 * iOS and Android Chrome shrink only the visual viewport for it, so a sheet
 * pinned to the bottom edge would type behind the keyboard: the sheet pads
 * its bottom by this much and scrolls the field above it.
 */
function useKeyboardInset(ref) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = ref.current;
    if (!vv || !el) return undefined;
    let timer = 0;
    const keepInView = () => {
      const field = document.activeElement;
      if (!isTextEntry(field) || !el.contains(field)) return;
      const bottom = vv.offsetTop + vv.height - 12;
      const over = field.getBoundingClientRect().bottom - bottom;
      if (over > 0) el.scrollTop += over;
    };
    const update = () => {
      const typing = isTextEntry(document.activeElement) && el.contains(document.activeElement);
      const covered = window.innerHeight - vv.height;
      // > 80 px: a keyboard, not a collapsing toolbar or a pinch zoom
      setInset(typing && covered > 80 ? Math.round(covered) : 0);
      clearTimeout(timer);
      timer = setTimeout(keepInView, 50);
    };
    vv.addEventListener('resize', update);
    el.addEventListener('focusin', update);
    el.addEventListener('focusout', update);
    return () => {
      clearTimeout(timer);
      vv.removeEventListener('resize', update);
      el.removeEventListener('focusin', update);
      el.removeEventListener('focusout', update);
    };
  }, [ref]);
  return inset;
}

/**
 * Bottom sheet (tablet/phone inspector, filters, actions): a paper panel
 * from the bottom edge behind a white veil - no shadow, one hairline.
 */
export function BottomSheet({ title, onClose, children, label }) {
  const ref = useRef(null);
  useDialogFocus(ref, onClose, { focusSelf: true, modal: true });
  useScrollLock();
  const keyboard = useKeyboardInset(ref);
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" data-library-overlay>
      <div className="absolute inset-0 touch-none bg-paper/70" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label || title}
        tabIndex={-1}
        className="pl-safe-inset pr-safe-inset relative max-h-[85vh] overflow-y-auto overscroll-contain border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] outline-none supports-[height:100dvh]:max-h-[85dvh]"
        style={keyboard ? { paddingBottom: keyboard } : undefined}
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
 * Desktop popover anchored to its button (⋯ menus, Tag filter): fixed
 * position so the sticky toolbar / scrolling list can't clip it; closes on
 * outside click, Escape and scroll. `anchor` is the button (or a rect).
 */
export function Popover({ anchor, onClose, children, width = 240, align = 'right', label }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const opener = anchor instanceof Element ? anchor : null;
  useDialogFocus(ref, onClose, { opener });

  useLayoutEffect(() => {
    const rect = opener ? opener.getBoundingClientRect() : anchor;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = ref.current?.offsetHeight || 0;
    let left = align === 'right' ? rect.right - width : rect.left;
    left = Math.max(8, Math.min(left, vw - width - 8));
    let top = rect.bottom + 4;
    if (top + h > vh - 8 && rect.top - h - 4 > 8) top = rect.top - h - 4;
    setPos({ left, top });
  }, [anchor, opener, width, align]);

  useEffect(() => {
    const onDown = (e) => {
      // The button that opened it toggles it: closing here made its click
      // open it again, so ⋯ / Tag ▾ / Tag… couldn't close their own popover.
      if (ref.current?.contains(e.target) || opener?.contains(e.target)) return;
      onClose();
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
  }, [onClose, opener]);

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
  // Clear of the landscape notch / rounded corners and the home indicator.
  return createPortal(
    <div
      role="status"
      className={`fixed left-1/2 z-50 flex max-w-[calc(100vw-32px-env(safe-area-inset-left)-env(safe-area-inset-right))] -translate-x-1/2 items-baseline gap-4 border border-line bg-paper px-4 py-2 ${
        raised ? 'bottom-[calc(64px+env(safe-area-inset-bottom))]' : 'bottom-[calc(16px+env(safe-area-inset-bottom))]'
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
