import React, { useState } from 'react';
import Mixer from './Mixer';
import RetryPanel from './RetryPanel';
import TextButton from './TextButton';
import ReturnIcon from './ReturnIcon';
import useTaskModel from './useTaskModel';

export default function ResultScreen({ taskId, result, model, setStep, onRetried }) {
  const tracks = result?.tracks || [];
  const recoveredTracks = result?.recovered_tracks || [];
  const [retrying, setRetrying] = useState(false);
  // /result doesn't report the separation model; look it up once the panel opens.
  const jobModel = useTaskModel(taskId, result?.model || model, retrying);

  return (
    <div className="flex w-full flex-col">
      <div className="mx-auto mb-12 mt-8 max-w-[720px] text-center md:mb-16 md:mt-16">
        <h1 className="m-0 mb-3 text-title-sm font-light leading-tight md:text-title">Your Stems</h1>
        {result?.name && <p className="m-0 mb-2 truncate text-muted">{result.name}</p>}
        <p className="m-0 mb-4 text-h3">
          {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
        </p>
        <p className="m-0 text-muted">
          {result?.recovered ? `Restored with ${result.recovery_model}` : 'Separated without restoration'}
        </p>
        <div className="mt-6 flex flex-wrap items-baseline justify-center gap-x-8 gap-y-3">
          <TextButton label="New File" onClick={() => setStep('upload')}>
            <span className="inline-flex items-center gap-2">
              <ReturnIcon />
              <span>New File</span>
            </span>
          </TextButton>
          <TextButton
            muted
            current={retrying}
            aria-expanded={retrying}
            onClick={() => setRetrying((r) => !r)}
            title="Run this job again with a different model or restoration"
          >
            Retry with other settings
          </TextButton>
        </div>
        {retrying && (
          <RetryPanel
            className="mx-auto mt-8 max-w-[480px] border-t border-line pt-6 text-left max-md:text-center"
            taskId={taskId}
            initialModel={jobModel}
            initialRecover={!!result?.recovered}
            initialRecoveryModel={result?.recovery_model}
            onStarted={onRetried}
            onCancel={() => setRetrying(false)}
          />
        )}
      </div>

      <Mixer taskId={taskId} tracks={tracks} recoveredTracks={recoveredTracks} />
    </div>
  );
}
