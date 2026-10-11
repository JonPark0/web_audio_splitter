// Pointer plumbing shared by the timeline's drags (clips, handles, selection
// box, placement, loop edges and markers on the ruler).

export const DRAG_THRESHOLD_PX = 3;
export const TOUCH_SLOP_PX = 8; // finger movement that still counts as a tap / press
export const LONG_PRESS_MS = 300;
const EDGE_PX = 32; // auto-scroll zone inside the visible lanes' edges
const EDGE_SPEED = 1200; // px/s with the pointer at (or past) the edge
const TAP_CLICK_MS = 1000; // how long a tap's click may lag its pointerup

/**
 * Window listeners for ONE pointer, from its pointerdown until it lifts.
 * Other pointers (a second finger, a palm, the hand under a pen) never feed
 * or end the gesture. Escape cancels it, and so does anything that means
 * the release was missed (the window lost focus, the same pointer pressed
 * again). Returns `stop()` (no callbacks).
 */
export function followPointer(down, { move, up, cancel }) {
  const id = down.pointerId;
  const first = down.nativeEvent || down; // still bubbling to window right now
  const abort = () => {
    stop();
    cancel?.();
  };
  const onMove = (ev) => {
    if (ev.pointerId === id) move?.(ev);
  };
  const onUp = (ev) => {
    if (ev.pointerId !== id) return;
    stop();
    up?.(ev);
  };
  const onCancel = (ev) => {
    if (ev.pointerId === id && ev !== first) abort();
  };
  // Capture, so the screen's Escape (clear selection, disarm) sees it handled.
  const onKey = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    abort();
  };
  function stop() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('pointerdown', onCancel);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', abort);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('pointerdown', onCancel);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', abort);
  return stop;
}

/**
 * Call from a finger tap's pointerup: runs `tap()` on the click that follows.
 * A tap that stops a fling (momentum scroll) still gets its pointerdown and
 * pointerup, but the browser drops its click - so that click, not the
 * pointerup, is what makes a tap. Forgotten at the next pointerdown, or when
 * no click comes.
 */
export function onTapClick(tap) {
  const onClick = () => {
    stop();
    tap();
  };
  const timer = setTimeout(stop, TAP_CLICK_MS);
  function stop() {
    clearTimeout(timer);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('pointerdown', stop, true);
  }
  window.addEventListener('click', onClick, true);
  window.addEventListener('pointerdown', stop, true);
}

/**
 * A finger on a handle that drags sideways (trim, fade, loop edge). The
 * handle is `touch-action: pan-y`, so a vertical swipe stays the browser's
 * scroll; the timeline isn't claimed (that would block the scroll) until
 * the finger goes sideways. Then `start()` returns the drag's session
 * (dragSession, null when it can't claim) and `end(commit)` closes it. A
 * finger that lifts where it landed calls `tap()` on its click.
 */
export function sidewaysTouch(down, { start, end, tap }) {
  const x0 = down.clientX;
  const y0 = down.clientY;
  let s = null;
  let off = false; // scrolling (or the claim failed): not ours
  let still = true;
  followPointer(down, {
    move: (ev) => {
      if (s) {
        s.move(ev.clientX, ev.clientY);
        return;
      }
      const dx = Math.abs(ev.clientX - x0);
      const dy = Math.abs(ev.clientY - y0);
      if (Math.hypot(dx, dy) > TOUCH_SLOP_PX) still = false;
      if (off) return;
      if (dy > dx) {
        if (dy > TOUCH_SLOP_PX) off = true;
        return;
      }
      if (dx <= DRAG_THRESHOLD_PX) return;
      s = start();
      if (s) s.move(ev.clientX, ev.clientY);
      else off = true;
    },
    up: () => {
      if (s) {
        s.end();
        end(true);
      } else if (still && !off) onTapClick(tap);
    },
    cancel: () => {
      if (!s) return;
      s.end();
      end(false);
    },
  });
}

/**
 * A pointerdown that preventDefaults keeps focus where it was, so after the
 * Snap select or a fader, arrows and Space kept going to them. Blur it (a
 * text field commits on blur) unless it sits inside `keep`.
 */
export function releaseFocus(keep) {
  const a = document.activeElement;
  if (a && a !== document.body && typeof a.blur === 'function' && !keep?.contains(a)) a.blur();
}

/**
 * Scrolls `scroller` while the pointer is within EDGE_PX of the visible
 * area's edges (or past them), faster the deeper it goes. `inset` is the
 * part the pinned header column / ruler row cover. The drag re-reads the
 * pointer on the scroller's `scroll` event, so it needs no callback.
 */
export function edgeScroll(scroller, { left = 0, top = 0, x = true, y = true } = {}) {
  let px = null;
  let py = null;
  let raf = 0;
  let last = 0;
  let accX = 0;
  let accY = 0;
  const speed = (d) => Math.min(1, Math.max(0, (EDGE_PX - d) / EDGE_PX)) * EDGE_SPEED;
  const tick = (t) => {
    raf = 0;
    if (px === null || !scroller.isConnected) return;
    const r = scroller.getBoundingClientRect();
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
    last = t;
    const vx = x ? speed(r.left + scroller.clientWidth - px) - speed(px - (r.left + left)) : 0;
    const vy = y ? speed(r.top + scroller.clientHeight - py) - speed(py - (r.top + top)) : 0;
    if (!vx && !vy) {
      last = 0;
      return;
    }
    // Whole pixels only: fractional scrollLeft steps are dropped near the edge.
    accX += vx * dt;
    accY += vy * dt;
    const sx = Math.trunc(accX);
    const sy = Math.trunc(accY);
    accX -= sx;
    accY -= sy;
    if (sx) scroller.scrollLeft += sx;
    if (sy) scroller.scrollTop += sy;
    raf = requestAnimationFrame(tick);
  };
  return {
    update(cx, cy) {
      px = cx;
      py = cy;
      if (!raf) raf = requestAnimationFrame(tick);
    },
    stop() {
      px = null;
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

/**
 * One drag's hold on the timeline: `claim()` (blocks touch scrolling and
 * pinch, pauses Follow; null when another drag owns it), edge auto-scroll,
 * and `onMove(clientX, clientY)` re-run whenever the view scrolls under a
 * still pointer (auto-scroll, wheel, zoom). Positions must be read through
 * a rect inside the scrolled content (lanes, ruler), which includes the
 * scroll. `onMove` returns true once the drag is under way (past its
 * threshold) - only then do the edges scroll. Returns null when the claim
 * fails, else { move(cx, cy), end() }.
 */
export function dragSession({ scroller, claim, inset, axes }, onMove) {
  const release = claim();
  if (!release) return null;
  let last = null;
  const reread = () => last && onMove(last.x, last.y);
  const auto = scroller ? edgeScroll(scroller, { ...inset, ...axes }) : null;
  scroller?.addEventListener('scroll', reread, { passive: true });
  return {
    move(cx, cy) {
      last = { x: cx, y: cy };
      if (onMove(cx, cy)) auto?.update(cx, cy);
    },
    end() {
      auto?.stop();
      scroller?.removeEventListener('scroll', reread);
      release();
    },
  };
}
