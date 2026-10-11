/**
 * `test` for every spec: a worker-scoped `app` (own backend + database, see
 * app.mjs), `baseURL` pointing at it, `api` for setup/checks, and a guard
 * that fails the test on any uncaught page error or console error.
 *
 *   import { test, expect } from '../support/fixtures.mjs';
 *   test('...', async ({ page, api, app, isMobile }) => { ... });
 */
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { apiClient } from './api.mjs';
import { startApp } from './app.mjs';

// Console noise that isn't an app failure: aborted fetches when a screen
// unmounts, and the browser's own line for an HTTP error the UI handles.
const IGNORED = [/AbortError/i, /signal is aborted/i, /Failed to load resource/i, /net::ERR_ABORTED/i];

export const test = base.extend({
  app: [
    async ({}, use, workerInfo) => {
      const app = await startApp(workerInfo.workerIndex);
      await use(app);
      await app.stop();
    },
    { scope: 'worker', timeout: 120_000 },
  ],
  baseURL: async ({ app }, use) => use(app.url),
  api: async ({ app }, use) => use(apiClient(app.api)),
  // Each test starts with the default (fast, succeeding) fake separator.
  page: async ({ page, app }, use, testInfo) => {
    app.setSeparationDelay(2);
    app.setSeparationFails(false);
    const errors = [];
    const consoleLog = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      consoleLog.push(`${m.type()}: ${m.text()}`);
      if (m.type() === 'error' && !IGNORED.some((re) => re.test(m.text()))) errors.push(`console: ${m.text()}`);
    });
    await use(page);
    if (testInfo.status !== testInfo.expectedStatus) {
      try {
        await testInfo.attach('backend.log', { body: readFileSync(app.logFile).slice(-20_000), contentType: 'text/plain' });
      } catch {
        // no log yet
      }
      // The CI log shows a failure's stdout but not its attachments: print
      // what the page said (console, alerts and status lines).
      const notes = await page
        .locator('[role=alert], [role=status]')
        .allInnerTexts()
        .catch(() => []);
      const said = [...consoleLog.slice(-30), ...notes.filter((t) => t.trim()).map((t) => `ui: ${t.trim()}`)];
      if (said.length) console.log(`page said (${testInfo.project.name}):\n  ${said.join('\n  ')}`);
    }
    expect(errors, 'page errors / console errors').toEqual([]);
  },
});

export { expect };

/** True for the engines where CDP (multi-touch, pen) is available. */
export const hasCDP = (browserName) => browserName === 'chromium';
