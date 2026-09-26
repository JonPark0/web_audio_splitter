import React, { useEffect, useState } from 'react';
import { getStatus, getResult, isTaskGone } from '../api';
import ProgressStages from './ProgressStages';
import ErrorBanner from './ErrorBanner';
import Split from './Split';
import TextButton from './TextButton';
import RetryPanel from './RetryPanel';
import useTaskModel from './useTaskModel';

export default function ProcessingScreen({ taskId, recoveryState, model, setStep, setResult, onRetried }) {
  const [statusData, setStatusData] = useState({ status: 'queued' });
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  // A failed separation can be re-run from the same audio with other settings.
  const failed = statusData.status === 'failed';
  const jobModel = useTaskModel(taskId, model, retrying);

  useEffect(() => {
    // Self-scheduling poll: the next request is only queued once the previous
    // one settles, so slow responses never overlap (and a tick can't fire a
    // duplicate getResult while the first one is still in flight).
    let cancelled = false;
    let timer;

    const poll = async () => {
      try {
        const res = await getStatus(taskId);
        if (cancelled) return;
        setStatusData(res.data);

        if (res.data.status === 'completed') {
          const resultRes = await getResult(taskId);
          if (cancelled) return;
          setResult(resultRes.data);
          setStep('result');
          return;
        } else if (res.data.status === 'failed') {
          setError(res.data.error || 'Processing failed.');
          return;
        }
      } catch (e) {
        if (cancelled) return;
        if (isTaskGone(e)) {
          setError('This task is no longer on the server (it may have restarted). Please start over.');
          return;
        }
        console.error(e);
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };
    timer = setTimeout(poll, 2000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [taskId]);

  return (
    <Split title="Processing">
      <div className="flex flex-col gap-8">
        <ProgressStages
          recover={recoveryState?.recover}
          step={statusData.step || 'separating'}
          stepIndex={statusData.step_index}
          stepTotal={statusData.step_total}
          currentStem={statusData.current_stem}
          status={statusData.status}
        />

        {error && (
          <div className="flex flex-col items-center gap-4 md:items-start">
            <ErrorBanner message={error} />
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 max-md:justify-center">
              <TextButton onClick={() => setStep('upload')} className="text-h3">
                Start Over
              </TextButton>
              {failed && onRetried && (
                <TextButton
                  muted
                  current={retrying}
                  aria-expanded={retrying}
                  onClick={() => setRetrying((r) => !r)}
                  title="Run this job again with a different model or restoration"
                >
                  Retry with other settings
                </TextButton>
              )}
            </div>
            {failed && retrying && (
              <RetryPanel
                className="w-full border-t border-line pt-6"
                taskId={taskId}
                initialModel={jobModel}
                initialRecover={statusData.recover ?? recoveryState?.recover}
                initialRecoveryModel={statusData.recovery_model ?? recoveryState?.recoveryModel}
                onStarted={onRetried}
                onCancel={() => setRetrying(false)}
              />
            )}
          </div>
        )}
      </div>
    </Split>
  );
}
