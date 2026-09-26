import React, { useEffect, useState } from 'react';
import { getStatus, getResult } from '../api';
import ProgressStages from './ProgressStages';
import ErrorBanner from './ErrorBanner';
import Split from './Split';
import TextButton from './TextButton';

export default function ProcessingScreen({ taskId, recoveryState, setStep, setResult }) {
  const [statusData, setStatusData] = useState({ status: 'queued' });
  const [error, setError] = useState('');

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
            <TextButton onClick={() => setStep('upload')} className="text-h3">
              Start Over
            </TextButton>
          </div>
        )}
      </div>
    </Split>
  );
}
