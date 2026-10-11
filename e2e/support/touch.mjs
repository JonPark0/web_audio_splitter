/**
 * Finger gestures with real timing, through Chromium's DevTools protocol
 * (Input.dispatchTouchEvent): Playwright's own touchscreen only taps. Specs
 * using these skip other engines (see hasCDP in fixtures.mjs).
 *
 *   const t = await touch(page);
 *   await t.swipe({ x: 200, y: 600 }, { x: 200, y: 200 });
 *   await t.longPress({ x, y }, { holdMs: 700 });
 *   await t.pinch({ x, y }, 80, 220);
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p, i) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id ?? i, radiusX: 4, radiusY: 4, force: 1 })),
    });
  const path = async (points0, points1, steps, ms) => {
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      await send('touchMove', points0.map((p, k) => ({ id: p.id ?? k, x: p.x + (points1[k].x - p.x) * t, y: p.y + (points1[k].y - p.y) * t })));
      await sleep(ms / steps);
    }
  };

  return {
    async tap(p, { holdMs = 60 } = {}) {
      await send('touchStart', [p]);
      await sleep(holdMs);
      await send('touchEnd', []);
    },
    async doubleTap(p, { gapMs = 150 } = {}) {
      await this.tap(p);
      await sleep(gapMs);
      await this.tap(p);
    },
    /** Hold still (with optional jitter in px), then optionally drag. */
    async longPress(p, { holdMs = 700, jitter = 0, to = null, steps = 12, moveMs = 300 } = {}) {
      await send('touchStart', [p]);
      if (jitter) {
        await sleep(holdMs / 2);
        await send('touchMove', [{ x: p.x + jitter, y: p.y + jitter }]);
        await sleep(holdMs / 2);
      } else {
        await sleep(holdMs);
      }
      if (to) await path([p], [to], steps, moveMs);
      await send('touchEnd', []);
    },
    async swipe(from, to, { ms = 250, steps = 12 } = {}) {
      await send('touchStart', [from]);
      await path([from], [to], steps, ms);
      await send('touchEnd', []);
    },
    /** Two fingers around `center`, from `startGap` to `endGap` px apart. */
    async pinch(center, startGap, endGap, { ms = 300, steps = 12 } = {}) {
      const a0 = { id: 0, x: center.x - startGap / 2, y: center.y };
      const b0 = { id: 1, x: center.x + startGap / 2, y: center.y };
      await send('touchStart', [a0, b0]);
      await path([a0, b0], [{ x: center.x - endGap / 2, y: center.y }, { x: center.x + endGap / 2, y: center.y }], steps, ms);
      await send('touchEnd', []);
    },
    /** Low-level access for multi-finger scenarios (a palm mid-drag, ...). */
    start: (points) => send('touchStart', points),
    move: (points) => send('touchMove', points),
    end: (points = []) => send('touchEnd', points),
    cancel: () => send('touchCancel', []),
  };
}
