import React, { useEffect, useRef } from 'react';
import TextButton from '../TextButton';

/**
 * Bottom sheet for phone menus ("⋯"): a paper panel over a paper veil,
 * closed by the veil, Escape or Close. `full` makes it a full-screen page
 * (the phone extract sheet).
 */
export default function Sheet({ title, onClose, children, full = false, headerExtra = null }) {
  const panelRef = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    panelRef.current?.querySelector('button, [href], input, select')?.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.({ preventScroll: true });
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      {!full && <div className="absolute inset-0 bg-paper/70" onClick={onClose} aria-hidden="true" />}
      <div
        ref={panelRef}
        className={
          full
            ? 'rs-bottom-bar absolute inset-0 overflow-y-auto overscroll-contain bg-paper px-4'
            : 'rs-bottom-bar absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain border-t border-line bg-paper px-4 pb-2'
        }
      >
        <div className={`flex h-11 items-center gap-3 ${full ? 'sticky top-0 z-10 border-b border-line bg-paper' : ''}`}>
          <h2 className="m-0 min-w-0 flex-1 truncate text-h4 font-light capitalize">{title}</h2>
          {headerExtra}
          <TextButton onClick={onClose} className="rs-hit text-caption">
            Close
          </TextButton>
        </div>
        {children}
      </div>
    </div>
  );
}
