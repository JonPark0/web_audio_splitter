// Smoke test of the running app in headless Microsoft Edge (playwright-core,
// channel "msedge" — uses the installed browser, nothing is downloaded).
//
//   cd scripts/smoke && npm install && node smoke.mjs [--out <dir>]
//   APP_URL=http://localhost:3000 (default)
//
// For each top-level section, at a desktop and a phone viewport, it checks
// that the page renders, logs no console errors, and has no horizontal page
// overflow, and saves a full-page screenshot. Exits non-zero on any failure.
//
// Privacy: launches a fresh temporary profile with extensions disabled and
// only ever navigates to APP_URL.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APP_URL = process.env.APP_URL || 'http://localhost:3000';
const outArg = process.argv.indexOf('--out');
const OUT = resolve(outArg > -1 ? process.argv[outArg + 1] : 'screenshots');
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'mobile', viewport: { width: 375, height: 812 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];
const SECTIONS = ['Split', 'Library', 'Arrange'];

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-extensions', '--no-first-run', '--disable-sync', '--autoplay-policy=no-user-gesture-required'],
});

let failures = 0;
const fail = (msg) => {
  failures += 1;
  console.log(`  FAIL ${msg}`);
};

for (const vp of VIEWPORTS) {
  const context = await browser.newContext(vp);
  // Never leave the app's origin.
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith(APP_URL) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  for (const section of SECTIONS) {
    const tag = `${vp.name}/${section}`;
    errors.length = 0;
    const nav = page.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: section, exact: true });
    if (!(await nav.count())) {
      fail(`${tag}: section button not found`);
      continue;
    }
    await nav.click();
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 1) fail(`${tag}: horizontal page overflow ${overflow}px`);
    const relevant = errors.filter((e) => !/AbortError|signal is aborted/.test(e));
    if (relevant.length) fail(`${tag}: console errors: ${relevant.slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: join(OUT, `${vp.name}-${section.toLowerCase()}.png`), fullPage: true });
    console.log(`  ok   ${tag}`);
  }
  await context.close();
}

await browser.close();
console.log(failures ? `${failures} failure(s); screenshots in ${OUT}` : `PASS; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
