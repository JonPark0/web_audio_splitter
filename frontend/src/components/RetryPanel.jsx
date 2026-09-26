import React, { useEffect, useId, useState } from 'react';
import { retryTask, SEPARATION_MODELS } from '../api';
import Field from './Field';
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
  const selectId = useId();
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
      const detail = e.response?.data?.detail;
      setError(typeof detail === 'string' ? detail : 'Could not start the retry.');
      setStarting(false);
    }
  };

  // A <form> of its own: RecoveryControls' radios have fixed names, and
  // radios only group per form, so this keeps them apart from the upload
  // form's identical controls on the same page.
  return (
    <form
      className={`flex flex-col gap-6 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!starting) start();
      }}
    >
      <Field label="Separation model" htmlFor={selectId}>
        <select
          id={selectId}
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setModelTouched(true);
          }}
          className="ainput"
        >
          {SEPARATION_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </Field>

      <RecoveryControls
        recover={recover}
        setRecover={setRecover}
        recoveryModel={recoveryModel}
        setRecoveryModel={setRecoveryModel}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-5 max-md:justify-center">
          <TextButton type="submit" disabled={starting}>
            {starting ? 'Starting...' : 'Start'}
          </TextButton>
          <TextButton muted onClick={onCancel} disabled={starting}>
            Cancel
          </TextButton>
        </div>
        {error ? (
          <p className="m-0 text-caption" role="alert">
            <span className="text-muted">Error — </span>
            {error}
          </p>
        ) : (
          <p className="m-0 text-caption text-muted">Runs a new job from the same audio. This job and its stems are kept.</p>
        )}
      </div>
    </form>
  );
}
