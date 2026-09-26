import { useEffect, useState } from 'react';
import { getTasks } from '../api';

/**
 * The separation model a job ran with. /status and /result don't report it,
 * so when the caller doesn't already know it (e.g. a job that came straight
 * from the upload form) it's looked up in the recent-jobs list — only once
 * `enabled` turns on, so the result screen doesn't fetch it unasked.
 */
export default function useTaskModel(taskId, known, enabled) {
  const [looked, setLooked] = useState(null); // { taskId, model }

  useEffect(() => {
    if (!enabled || known || !taskId || looked?.taskId === taskId) return undefined;
    let cancelled = false;
    getTasks(200)
      .then((res) => {
        if (cancelled) return;
        const task = (res.data.tasks || []).find((t) => t.task_id === taskId);
        setLooked({ taskId, model: task?.model || null });
      })
      .catch(() => !cancelled && setLooked({ taskId, model: null }));
    return () => {
      cancelled = true;
    };
  }, [enabled, known, taskId, looked]);

  return known || (looked?.taskId === taskId ? looked.model : null) || undefined;
}
