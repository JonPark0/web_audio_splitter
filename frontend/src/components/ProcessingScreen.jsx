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
    const interval = setInterval(async () => {
      try {
        const res = await getStatus(taskId);
        setStatusData(res.data);

        if (res.data.status === 'completed') {
          const resultRes = await getResult(taskId);
          setResult(resultRes.data);
          setStep('result');
          clearInterval(interval);
        } else if (res.data.status === 'failed') {
          setError(res.data.error || 'Processing failed.');
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 2000);

    return () => clearInterval(interval);
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
