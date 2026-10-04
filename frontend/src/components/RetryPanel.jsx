import React, { useEffect, useState } from 'react';
import { errorDetail, retryTask } from '../api';
import ModelSelect from './jobs/ModelSelect';
import RecoveryControls from './RecoveryControls';
import TextButton from './TextButton';

/**
 * Inline "run this job again with other settings" form. Starts a NEW job from
 * the same source audio (the original job and its stems are kept) and hands
 * the new task back via `onStarted({ task_id, model, recover, recovery_model })`.
 */
export default function RetryPanel({
  taskId,
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
    try {
      const res = await retryTask(taskId, { model, recover, recoveryModel });
      onStarted({ task_id: res.data.task_id, model, recover, recovery_model: recoveryModel });
    } catch (e) {
      setError(errorDetail(e, 'Could not start the retry.'));
      setStarting(false);
    }
  };

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
          {starting ? 'Starting...' : 'Start retry'}
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
          <p className="m-0 text-caption text-muted">A new job from the same audio; this one and its stems are kept.</p>
        )}
      </div>
    </form>
  );
}
