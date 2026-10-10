import { defineConfig, devices } from '@playwright/test';

/**
 * UI tests against the real backend (see README.md). Each project is one
 * device profile; every spec runs on all of them unless it opts out
 * (test.skip on `isMobile` / browser). E2E_BROWSERS=chromium (comma list)
 * limits the run to the engines installed locally; CI installs all three.
 */
const wide = { width: 1440, height: 900 };
const ALL = [
  { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: wide } },
  { name: 'laptop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
  { name: 'desktop-firefox', use: { ...devices['Desktop Firefox'], viewport: wide } },
  { name: 'desktop-webkit', use: { ...devices['Desktop Safari'], viewport: wide } },
  { name: 'tablet-chromium', use: { ...devices['Galaxy Tab S4'] } },
  { name: 'tablet-webkit', use: { ...devices['iPad Pro 11'] } },
  { name: 'tablet-landscape-webkit', use: { ...devices['iPad Pro 11 landscape'] } },
  { name: 'phone-chromium', use: { ...devices['Pixel 7'] } },
  { name: 'phone-landscape-chromium', use: { ...devices['Pixel 7 landscape'] } },
  { name: 'phone-webkit', use: { ...devices['iPhone 13'] } },
  { name: 'phone-landscape-webkit', use: { ...devices['iPhone 13 landscape'] } },
];

const engines = (process.env.E2E_BROWSERS || '').split(',').map((s) => s.trim()).filter(Boolean);
const projects = engines.length ? ALL.filter((p) => engines.includes(p.use.defaultBrowserType)) : ALL;

export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.mjs',
  // Every worker runs its own backend + database (support/app.mjs), so
  // tests in different workers never see each other's jobs or samples.
  fullyParallel: false,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // Playback starts from real clicks anyway; on Chromium the flag keeps a
  // headless run from depending on how it counts a synthetic gesture.
  projects: projects.map((p) =>
    p.use.defaultBrowserType === 'chromium'
      ? { ...p, use: { ...p.use, launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } } }
      : p
  ),
});
