import React, { useEffect, useState } from 'react';
import { errorDetail, retryTask } from '../api';
import ModelSelect from './jobs/ModelSelect';
import RecoveryControls from './RecoveryControls';
import TextButton from './TextButton';

/**
 * Inline "run this job again with other settings" form. Starts a NEW job from
 * the same source audio (the original job and its stems are kept) and hands
 * the new task back via `onStarted({ task_id, model, recover, recovery_model })`.
 *
 * With `taskIds` (bulk) it retries each of them with the same settings, one
 * after another, and calls `onStarted({ started: [task...], failed: [message] })`.
 */
export default function RetryPanel({
  taskId,
  taskIds = null,
  initialModel = 'htdemucs',
  initialRecover = false,
  initialRecoveryModel,
  onStarted,
  onCancel,
  className = '',
}) {
  const [model, setModel] = useState(initialModel || 'htdemucs');
  const [recover, setRecover] = useState(!!initialRecover);
  const [recoveryModel, setRecoveryModel] = useState(initialRecoveryModel || 'apollo');
  const [starting, setStarting] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  // The job's model can arrive after the panel opens (looked up lazily);
  // adopt it unless the user has already picked one.
  const [modelTouched, setModelTouched] = useState(false);
  useEffect(() => {
    if (initialModel && !modelTouched) setModel(initialModel);
  }, [initialModel, modelTouched]);

  const start = async () => {
    setStarting(true);
    setError('');
    if (!taskIds) {
      try {
        const res = await retryTask(taskId, { model, recover, recoveryModel });
        onStarted({ task_id: res.data.task_id, model, recover, recovery_model: recoveryModel });
      } catch (e) {
        setError(errorDetail(e, 'Could not start the retry.'));
        setStarting(false);
      }
      return;
    }
    const started = [];
    const failed = [];
    for (const [i, id] of taskIds.entries()) {
      setProgress(`Starting ${i + 1}/${taskIds.length}...`);
      try {
        const res = await retryTask(id, { model, recover, recoveryModel });
        started.push({ task_id: res.data.task_id, model, recover, recovery_model: recoveryModel });
      } catch (e) {
        failed.push(errorDetail(e, 'Could not start the retry.'));
      }
    }
    setProgress('');
    if (!started.length) {
      setError(failed[0] || 'Could not start the retries.');
      setStarting(false);
      return;
    }
    onStarted({ started, failed });
  };
  const bulk = !!taskIds;

  // A <form> of its own, so Enter in the select submits this retry only.
  return (
    <form
      className={`flex max-w-xl flex-col gap-2 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!starting) start();
      }}
    >
      <ModelSelect
        value={model}
        disabled={starting}
        onChange={(v) => {
          setModel(v);
          setModelTouched(true);
        }}
      />
      <RecoveryControls
        recover={recover}
        setRecover={setRecover}
        recoveryModel={recoveryModel}
        setRecoveryModel={setRecoveryModel}
        disabled={starting}
      />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-1">
        <TextButton type="submit" disabled={starting}>
          {starting ? progress || 'Starting...' : bulk ? `Retry ${taskIds.length} ${taskIds.length === 1 ? 'job' : 'jobs'}` : 'Start retry'}
        </TextButton>
        <TextButton onClick={onCancel} disabled={starting}>
          Cancel
        </TextButton>
        {error ? (
          <p className="m-0 text-caption" role="alert">
            <span className="text-muted">Error — </span>
            {error}
          </p>
        ) : (
          <p className="m-0 text-caption text-muted">
            {bulk ? 'New jobs from the same audio; the originals and their stems are kept.' : 'A new job from the same audio; this one and its stems are kept.'}
          </p>
        )}
      </div>
    </form>
  );
}
