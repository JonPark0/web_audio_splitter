/**
 * Backend calls for test setup and for checking what the UI saved. Tests
 * drive the UI; these only seed data (jobs, samples, projects) quickly and
 * read the server's state back.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function apiClient(base) {
  const call = async (method, url, body, { raw = false } = {}) => {
    const init = { method };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.body = JSON.stringify(body);
      init.headers = { 'content-type': 'application/json' };
    }
    const res = await fetch(base + url, init);
    if (raw) return res;
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 300)}`);
    return data;
  };
  const fileForm = (filePath, fields = {}) => {
    const form = new FormData();
    form.append('file', new Blob([readFileSync(filePath)]), path.basename(filePath));
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    return form;
  };

  const api = {
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body),
    put: (url, body) => call('PUT', url, body),
    patch: (url, body) => call('PATCH', url, body),
    del: (url) => call('DELETE', url, undefined, { raw: true }),
    raw: (url, init) => fetch(base + url, init),

    /** Upload a file as a new job; resolves with its task id. */
    async createJob(filePath, { model = 'htdemucs', recover = false, recoveryModel = 'apollo' } = {}) {
      const res = await call('POST', '/upload', fileForm(filePath, { model, recover, recovery_model: recoveryModel }));
      return res.task_id;
    },
    /** Poll until the job reaches one of `states` (default completed/failed). */
    async waitJob(taskId, states = ['completed', 'failed', 'cancelled'], timeoutMs = 60_000) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const s = await call('GET', `/status/${taskId}`);
        if (states.includes(s.status)) return s;
        if (Date.now() > until) throw new Error(`job ${taskId} stuck in ${s.status}`);
        await new Promise((r) => setTimeout(r, 400));
      }
    },
    async completedJob(filePath, opts) {
      const id = await api.createJob(filePath, opts);
      const s = await api.waitJob(id);
      if (s.status !== 'completed') throw new Error(`job ${id} ${s.status}: ${s.error}`);
      return id;
    },
    /** Cut a sample from a finished job's stem. */
    cutSample(taskId, { track = 'drums.wav', start = 2, end = 6, name = 'cut', tags = [] } = {}) {
      return call('POST', '/samples', { task_id: taskId, track, variant: 'original', start_sec: start, end_sec: end, name, tags });
    },
    importSample(filePath, { name, tags = [] } = {}) {
      return call('POST', '/samples/import', fileForm(filePath, { ...(name ? { name } : {}), tags: tags.join(',') }));
    },
    /** Wait until every sample's analysis finished (BPM/key known or given up). */
    async analysedSamples(timeoutMs = 60_000) {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const { samples } = await call('GET', '/samples');
        if (samples.every((s) => s.analysis_status !== 'pending' && s.analysis_status !== 'running')) return samples;
        if (Date.now() > until) return samples;
        await new Promise((r) => setTimeout(r, 500));
      }
    },
    createProject(name = 'Test project', bpm = 120) {
      return call('POST', '/projects', { name, bpm });
    },
  };
  return api;
}
