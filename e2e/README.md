# UI tests

Playwright tests that drive the app in real browsers against the **real
backend** (FastAPI + PostgreSQL), on desktop, tablet and phone profiles
(`playwright.config.mjs`). They run on every pull request in GitHub Actions
(`.github/workflows/e2e.yml`) on Chromium, Firefox and WebKit.

## What's real and what isn't

- Real: the backend and its database, uploads (incl. resumable chunks),
  job queue, peaks, onsets, BPM/key analysis, sample cutting/import/export,
  time-stretch renders, projects, every browser API the UI uses.
- Stand-ins: separation. `bin/demucs` and `bin/bs-roformer-infer` write
  filtered copies of the input as stems, so no model weights are needed.
  A test can slow them down or make them fail through the app fixture
  (`app.setSeparationDelay(seconds)`, `app.setSeparationFails(true)`).
- Not covered: the recovery models (Apollo/AudioSR/FlashSR), YouTube
  downloads (no network in CI for that), and real-device-only behaviour
  (the iPhone silent switch, on-screen keyboards, a physical stylus).

Each Playwright worker gets its own database and backend
(`support/app.mjs`), so tests running in parallel never see each other's
jobs, samples or projects. Test audio is generated with ffmpeg on the first
run (`support/media.mjs`).

## Running locally

Needs Node 18+, Python 3.11, ffmpeg and a PostgreSQL the tests may create
databases on.

```bash
python3.11 -m venv .venv && .venv/bin/pip install -r e2e/requirements.txt
cd e2e && npm ci && npx playwright install chromium   # or: --with-deps chromium firefox webkit

E2E_PYTHON=../.venv/bin/python \
E2E_PG_URL=postgresql://postgres:postgres@127.0.0.1:5432 \
npx playwright test                       # all devices and engines installed
E2E_BROWSERS=chromium npx playwright test # Chromium profiles only
npx playwright test tests/library.spec.mjs --project=phone-webkit --headed
npx playwright show-report                # last run's HTML report
```

The frontend is built into `frontend/dist` on the first run; set
`E2E_REBUILD=1` after changing frontend code.

## Writing tests

```js
import { test, expect } from '../support/fixtures.mjs';

test('...', async ({ page, api, app, isMobile, browserName }) => {
  const taskId = await api.completedJob(media('song120.mp3')); // seed via the API
  await page.goto(`/#/split/job/${taskId}`);                  // drive the UI
  ...
});
```

- A test fails on any page error or console error (see `fixtures.mjs`).
- Multi-finger gestures and pen input need Chromium's DevTools protocol:
  `support/touch.mjs`, guarded with `test.skip(!hasCDP(browserName))`.
- Known app bugs are marked `test.fail()` with the reason, so the suite
  stays green until the bug is fixed and then flags the stale marker.
