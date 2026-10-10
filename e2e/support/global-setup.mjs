/**
 * Once per run: a production build of the frontend (unless one exists and
 * E2E_REBUILD isn't set), the test audio (generated with ffmpeg, so no media
 * files live in the repo), and a fail-fast check of the backend's Python.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CACHE, REPO } from './app.mjs';
import { MEDIA, MEDIA_DIR } from './media.mjs';

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

export default async function globalSetup() {
  const python = process.env.E2E_PYTHON || 'python3';
  try {
    execFileSync(python, ['-c', 'import fastapi, uvicorn, psycopg, alembic, soundfile, librosa, pedalboard'], { stdio: 'pipe' });
  } catch {
    throw new Error(`E2E_PYTHON (${python}) is missing backend deps: pip install -r e2e/requirements.txt`);
  }

  const frontend = path.join(REPO, 'frontend');
  if (process.env.E2E_REBUILD || !existsSync(path.join(frontend, 'dist', 'index.html'))) {
    run('npm', ['run', 'build'], { cwd: frontend });
  }

  mkdirSync(MEDIA_DIR, { recursive: true });
  mkdirSync(CACHE, { recursive: true });
  for (const [file, ffmpegArgs] of Object.entries(MEDIA)) {
    const out = path.join(MEDIA_DIR, file);
    if (!existsSync(out)) run('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', ...ffmpegArgs, out]);
  }
}
