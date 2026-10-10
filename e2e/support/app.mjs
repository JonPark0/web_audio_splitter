/**
 * One isolated app per Playwright worker: a fresh PostgreSQL database, the
 * real FastAPI backend (uvicorn) in its own media directory with the fake
 * separators from e2e/bin on PATH, and a small server that serves the built
 * frontend (frontend/dist) and proxies /api to that backend - the same URL
 * layout as the Vite dev server and the Docker setup.
 *
 * Environment:
 *   E2E_PYTHON   Python with e2e/requirements.txt installed (default python3)
 *   E2E_PG_URL   PostgreSQL server the tests may create databases on
 *                (default postgresql://postgres:postgres@127.0.0.1:5432)
 */
import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync, openSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const E2E_DIR = path.resolve(HERE, '..');
export const REPO = path.resolve(E2E_DIR, '..');
export const CACHE = path.join(E2E_DIR, '.cache');
const DIST = path.join(REPO, 'frontend', 'dist');
const PYTHON = process.env.E2E_PYTHON || 'python3';
const PG_URL = (process.env.E2E_PG_URL || 'postgresql://postgres:postgres@127.0.0.1:5432').replace(/\/$/, '');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function psql(sql) {
  // psycopg is installed with the backend deps; no psql client needed.
  execFileSync(PYTHON, ['-c', 'import psycopg,sys\nwith psycopg.connect(sys.argv[1], autocommit=True) as c: c.execute(sys.argv[2])', `${PG_URL}/postgres`, sql], {
    stdio: 'pipe',
  });
}

async function waitFor(url, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > until) throw new Error(`Timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain' };

/** Static frontend + /api proxy (streams bodies both ways: uploads, Range). */
function startFrontend(port, backendPort) {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/') || req.url === '/api') {
      const upstream = http.request(
        { host: '127.0.0.1', port: backendPort, method: req.method, path: req.url.slice(4) || '/', headers: { ...req.headers, host: `127.0.0.1:${backendPort}` } },
        (up) => {
          res.writeHead(up.statusCode, up.headers);
          up.pipe(res);
        }
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    const clean = decodeURIComponent(req.url.split('?')[0]);
    let file = path.join(DIST, clean);
    if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/**
 * Starts the stack for one worker and returns
 * { url, api, mediaDir, setSeparationDelay(sec), setSeparationFails(bool), stop() }.
 */
export async function startApp(workerIndex) {
  const id = `e2e_${process.pid}_${workerIndex}`;
  const mediaDir = path.join(CACHE, 'workers', id);
  rmSync(mediaDir, { recursive: true, force: true });
  mkdirSync(mediaDir, { recursive: true });

  psql(`DROP DATABASE IF EXISTS ${id} WITH (FORCE)`);
  psql(`CREATE DATABASE ${id}`);
  const env = {
    ...process.env,
    DATABASE_URL: `${PG_URL.replace(/^postgres(ql)?:/, 'postgresql+psycopg:')}/${id}`,
    PATH: `${path.join(E2E_DIR, 'bin')}${path.delimiter}${process.env.PATH}`,
    PYTHONPATH: path.join(REPO, 'backend'),
    PYTHONUNBUFFERED: '1',
  };
  execFileSync(PYTHON, ['-m', 'alembic', 'upgrade', 'head'], { cwd: path.join(REPO, 'backend'), env, stdio: 'pipe' });

  const backendPort = await freePort();
  const log = openSync(path.join(mediaDir, 'backend.log'), 'a');
  const backend = spawn(PYTHON, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(backendPort)], {
    cwd: mediaDir, // backend paths are relative ("media/...")
    env,
    stdio: ['ignore', log, log],
    detached: true,
  });
  const api = `http://127.0.0.1:${backendPort}`;
  await waitFor(`${api}/tasks`);

  const port = await freePort();
  const frontend = await startFrontend(port, backendPort);

  return {
    url: `http://127.0.0.1:${port}`,
    api,
    mediaDir,
    logFile: path.join(mediaDir, 'backend.log'),
    setSeparationDelay(sec) {
      writeFileSync(path.join(mediaDir, 'fake-sep-delay'), String(sec));
    },
    setSeparationFails(fail) {
      const f = path.join(mediaDir, 'fake-sep-fail');
      if (fail) writeFileSync(f, '');
      else rmSync(f, { force: true });
    },
    async stop() {
      frontend.close();
      try {
        process.kill(-backend.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      await new Promise((r) => setTimeout(r, 300));
      try {
        psql(`DROP DATABASE IF EXISTS ${id} WITH (FORCE)`);
      } catch {
        // left for the next run's DROP ... IF EXISTS
      }
    },
  };
}
