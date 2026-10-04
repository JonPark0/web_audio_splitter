import React, { useCallback, useEffect, useState } from 'react';
import { errorDetail, getResult } from '../api';
import { href, navigate } from '../router';
import Mixer from './Mixer';
import RetryPanel from './RetryPanel';
import TextButton from './TextButton';

/**
 * A finished job's stems (route /split/job/<taskId>, once completed). Fetches
 * its own /result; the mixer, extract and job actions live below.
 */
export default function ResultScreen({ taskId }) {
  const [state, setState] = useState({ status: 'loading' });
  const [song, setSong] = useState({ bpm: null, key: null });
  const [retrying, setRetrying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    getResult(taskId)
      .then((res) => {
        if (cancelled) return;
        setState({ status: 'ready', result: res.data });
        setSong({ bpm: res.data.bpm ?? null, key: res.data.key ?? null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ status: 'error', code: err?.response?.status, message: errorDetail(err, 'Could not load the stems') });
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, attempt]);

  // Old jobs get tempo/key analysed on first open: ask again a few times.
  const result = state.result;
  useEffect(() => {
    if (!result || !('bpm' in result) || song.bpm) return undefined;
    let tries = 0;
    let cancelled = false;
    const id = setInterval(() => {
      tries += 1;
      getResult(taskId)
        .then((res) => {
          if (cancelled) return;
          if (res.data.bpm || res.data.key) setSong({ bpm: res.data.bpm ?? null, key: res.data.key ?? null });
        })
        .catch(() => {});
      if (tries >= 5) clearInterval(id);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [result, song.bpm, taskId]);

  const onStarted = useCallback(({ task_id: id }) => navigate(`/split/job/${id}`), []);

  if (state.status === 'loading') {
    return (
      <p className="m-0 flex h-8 items-center text-caption text-muted" role="status">
        Loading stems…
      </p>
    );
  }

  if (state.status === 'error') {
    const gone = state.code === 404;
    const notDone = state.code === 400;
    return (
      <div className="flex min-h-8 flex-wrap items-baseline gap-x-5 gap-y-1 py-1 text-caption" role="alert">
        <p className="m-0">
          <span className="text-muted">{gone ? 'Gone — ' : notDone ? 'No stems — ' : 'Error — '}</span>
          {gone
            ? "this job's stems are no longer on the server (deleted or expired)."
            : notDone
              ? "this job hasn't finished, failed, or no longer exists."
              : state.message}
        </p>
        {!gone && !notDone && (
          <TextButton onClick={() => setAttempt((n) => n + 1)} className="rs-hit">
            Try again
          </TextButton>
        )}
        <TextButton as="a" href={href('/split')} className="rs-hit">
          ← Jobs
        </TextButton>
      </div>
    );
  }

  return (
    <Mixer
      key={taskId}
      taskId={taskId}
      result={result}
      bpm={song.bpm}
      songKey={song.key}
      retrying={retrying}
      onRetryToggle={() => setRetrying((r) => !r)}
      retryPanel={
        retrying ? (
          <RetryPanel
            className="max-w-measure border-t border-line py-3"
            taskId={taskId}
            initialModel={result.model}
            initialRecover={result.recover ?? !!result.recovered}
            initialRecoveryModel={result.recovery_model}
            onStarted={onStarted}
            onCancel={() => setRetrying(false)}
          />
        ) : null
      }
    />
  );
}
