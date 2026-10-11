import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useScrollLock } from '../../scrollLock';
import TextButton from '../TextButton';

/**
 * Bottom sheet for phone menus ("⋯"): a paper panel over a paper veil,
 * closed by the veil, Escape or Close. `full` makes it a full-screen page
 * (the phone extract sheet) whose title bar, with `pinned` under it (the
 * sheet's waveform), stays on top. px-safe like the page column: clear of a
 * landscape notch, and the extract sheet's lane is exactly as wide as the
 * timeline it draws. The page behind holds still while it's open (scroll
 * lock, a veil that takes no touch panning), as with the Library's sheets.
 */
export default function Sheet({ title, onClose, children, full = false, headerExtra = null, pinned = null }) {
  const panelRef = useRef(null);
  const topRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useScrollLock();
  // Once per open: callers pass a new inline onClose on every render, and
  // re-running this on one (a focused time field re-renders the mixer)
  // moved focus to Close mid-edit.
  useEffect(() => {
    const prev = document.activeElement;
    panelRef.current?.querySelector('button, [href], input, select')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  // A field scrolled or focused into view stops below the pinned top, not
  // under it (on a landscape phone the top is over half the screen).
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const top = topRef.current;
    if (!panel || !top) return undefined;
    const fit = () => {
      panel.style.scrollPaddingTop = `${top.offsetHeight}px`;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(top);
    fit();
    return () => ro.disconnect();
  }, [full]);

  const bar = (
    <div className={`flex h-11 items-center gap-3 ${full ? 'border-b border-line' : ''}`}>
      <h2 className="m-0 min-w-0 flex-1 truncate text-h4 font-light capitalize">{title}</h2>
      {headerExtra}
      <TextButton onClick={onClose} className="rs-hit text-caption">
        Close
      </TextButton>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      {!full && <div className="absolute inset-0 touch-none bg-paper/70" onClick={onClose} aria-hidden="true" />}
      <div
        ref={panelRef}
        className={
          full
            ? 'rs-bottom-bar px-safe absolute inset-0 overflow-y-auto overscroll-contain bg-paper'
            : 'rs-bottom-bar px-safe absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain border-t border-line bg-paper pb-2'
        }
      >
        {full ? (
          <div ref={topRef} className="sticky top-0 z-10 bg-paper">
            {bar}
            {pinned}
          </div>
        ) : (
          bar
        )}
        {children}
      </div>
    </div>
  );
}
