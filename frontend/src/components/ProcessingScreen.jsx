import React, { useEffect, useRef, useState } from 'react';
import { cancelTask, errorDetail } from '../api';
import ProgressStages from './ProgressStages';
import TextButton from './TextButton';
import Hairline from './jobs/Hairline';
import { estimate } from './jobs/eta';
import { formatDuration, formatSpan } from './jobs/format';
import { jobsChanged } from './jobs/jobsStore';

function Meta({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="m-0 break-words tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * Progress of a queued / running job (the job view polls and passes the
 * /status payload as `task`): settings, audio length, elapsed time, an
 * estimate of what's left, the stages, and Cancel (which asks first: the
 * work done so far is lost).
 */
export default function ProcessingScreen({ taskId, task, now, calib, onChanged }) {
  const [cancelState, setCancelState] = useState(''); // '' | 'sending' | 'cancelling'
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const est = estimate(task, now, calib);
  const queued = task.status === 'queued';

  // Focus follows the question in and out (the button pressed is replaced).
  const askRef = useRef(null);
  const confirmRef = useRef(null);
  const shown = useRef(confirming);
  useEffect(() => {
    if (shown.current === confirming) return;
    shown.current = confirming;
    if (confirming) confirmRef.current?.focus();
    else if (!document.activeElement || document.activeElement === document.body) askRef.current?.focus();
  }, [confirming]);

  const cancel = async () => {
    setCancelState('sending');
    setError('');
    try {
      const res = await cancelTask(taskId);
      setConfirming(false);
      setCancelState(res.data?.status === 'cancelling' ? 'cancelling' : '');
      jobsChanged();
      onChanged?.();
    } catch (e) {
      setCancelState('');
      setError(errorDetail(e, 'Could not cancel this job.'));
    }
  };

  let remaining = '—';
  if (queued) remaining = task.queue_position ? `starts after ${task.queue_position} more` : 'starting soon';
  else if (est?.total) remaining = est.remaining > 1 ? `about ${formatSpan(est.remaining)}` : 'any moment now';

  const bar = queued ? null : est?.fraction ?? 'indeterminate';

  return (
    <div className="flex flex-col gap-3">
      <dl className="m-0 grid grid-cols-3 gap-x-4 gap-y-2 sm:gap-x-6">
        <Meta label="Model">{task.model || '—'}</Meta>
        <Meta label="Restoration">{task.recover ? task.recovery_model : 'Off'}</Meta>
        <Meta label="Audio">{formatDuration(task.duration) || '—'}</Meta>
        <Meta label="Elapsed">{task.started_at && est ? formatSpan(est.elapsed) : 'not started'}</Meta>
        <Meta label="Remaining">{remaining}</Meta>
        <Meta label="Done">{typeof bar === 'number' ? `about ${Math.round(bar * 100)}%` : queued ? '0%' : '—'}</Meta>
      </dl>

      <ProgressStages task={task} />
      <Hairline value={bar} label="Job progress" />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        {confirming ? (
          <>
            <span className="text-caption">Cancel this job? The work done on it so far is lost.</span>
            <TextButton ref={confirmRef} onClick={cancel} disabled={!!cancelState}>
              {cancelState === 'sending' ? 'Cancelling...' : 'Cancel job'}
            </TextButton>
            <TextButton onClick={() => setConfirming(false)} disabled={!!cancelState}>
              Keep running
            </TextButton>
          </>
        ) : (
          <TextButton ref={askRef} onClick={() => setConfirming(true)} disabled={!!cancelState}>
            {cancelState === 'cancelling' ? 'Stopping the worker...' : 'Cancel job'}
          </TextButton>
        )}
        {error ? (
          <p className="m-0 text-caption" role="alert">
            <span className="text-muted">Error — </span>
            {error}
          </p>
        ) : (
          !confirming && <p className="m-0 text-caption text-muted">You can leave this page — the job keeps running and shows in Jobs.</p>
        )}
      </div>
    </div>
  );
}
