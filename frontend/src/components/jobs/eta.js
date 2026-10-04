import { useEffect, useState } from 'react';
import { getTasks } from '../../api';

/**
 * Time estimates for a running job: total ≈ OVERHEAD + audio duration ×
 * realtime factor. The factor is calibrated from this server's own finished
 * jobs of a minute or more ((finished_at − started_at − OVERHEAD) / duration,
 * median per model + restoration — on short clips the overhead swamps it),
 * falling back to defaults measured on the 12 GB GPU box: htdemucs took
 * 7.5 s / 8.0 s for 10 s / 12 s clips, htdemucs + apollo 19.7 s for 15 s.
 */
const OVERHEAD = 8; // model load, song analysis, file moves (s)
const MIN_CALIBRATION_SECONDS = 60;

// Separation, seconds of work per second of audio.
const SEPARATION = {
  htdemucs: 0.08,
  htdemucs_ft: 0.3, // a bag of four models
  htdemucs_6s: 0.1,
  hdemucs_mmi: 0.1,
  mdx: 0.15,
  mdx_extra: 0.2,
  mdx_q: 0.15,
  mdx_extra_q: 0.2,
  SIG: 0.1,
  bs_roformer: 0.25,
};
// Restoration, per stem, seconds of work per second of audio.
const RESTORATION = { apollo: 0.15, audiosr: 1.5, flashsr: 0.04 };
// Stems the restoration pass works through (derived stems are skipped).
const STEMS = { bs_roformer: 6, htdemucs_6s: 6 };

const keyOf = (t) => `${t.model}|${t.recover ? t.recovery_model : '-'}`;

function defaultParts(task) {
  const sep = SEPARATION[task.model] ?? 0.15;
  const restore = task.recover ? (RESTORATION[task.recovery_model] ?? 0.2) * (STEMS[task.model] ?? 4) : 0;
  return { sep, restore };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** { "<model>|<restorer or ->": factor } from finished jobs. */
export function calibrate(tasks) {
  const buckets = {};
  for (const t of tasks || []) {
    if (t.status !== 'completed' || !t.started_at || !t.finished_at || !(t.duration >= MIN_CALIBRATION_SECONDS)) continue;
    const elapsed = (new Date(t.finished_at) - new Date(t.started_at)) / 1000;
    if (!(elapsed > 0)) continue;
    (buckets[keyOf(t)] ||= []).push(Math.max(0, elapsed - OVERHEAD) / t.duration);
  }
  return Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, median(v)]));
}

let calibrationPromise = null;
function loadCalibration() {
  calibrationPromise ||= getTasks({ limit: 200, status: 'completed' })
    .then((res) => calibrate(res.data?.tasks))
    .catch(() => {
      calibrationPromise = null;
      return {};
    });
  return calibrationPromise;
}

export function useEtaCalibration() {
  const [calib, setCalib] = useState({});
  useEffect(() => {
    let alive = true;
    loadCalibration().then((c) => alive && setCalib(c));
    return () => {
      alive = false;
    };
  }, []);
  return calib;
}

/**
 * { elapsed, total, remaining, fraction } for a job that has started, or
 * null. `fraction` is the overall share done (0..0.99): time-based, but never
 * behind the real restoring k/n.
 */
export function estimate(task, now = Date.now(), calib = {}) {
  if (!task?.started_at) return null;
  const elapsed = Math.max(0, (now - new Date(task.started_at).getTime()) / 1000);
  const duration = task.duration > 0 ? task.duration : null;
  if (!duration) return { elapsed, total: null, remaining: null, fraction: null };
  const { sep, restore } = defaultParts(task);
  const factor = calib[keyOf(task)] ?? sep + restore;
  const total = OVERHEAD + duration * factor;
  let fraction = Math.min(0.99, elapsed / total);
  if (task.status === 'restoring' && task.step_total) {
    const sepShare = (OVERHEAD + duration * sep) / (OVERHEAD + duration * (sep + restore));
    fraction = Math.max(fraction, Math.min(0.99, sepShare + (1 - sepShare) * ((task.step_index || 0) / task.step_total)));
  }
  return { elapsed, total, remaining: Math.max(0, total - elapsed), fraction };
}
