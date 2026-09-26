import React, { useEffect, useState } from 'react';
import { getStatus, youtubeConfirm, youtubePreviewUrl } from '../api';
import ErrorBanner from './ErrorBanner';
import Split from './Split';
import TextButton from './TextButton';

export default function YouTubeConfirmScreen({ taskId, ytMeta, setStep }) {
  const [downloadStatus, setDownloadStatus] = useState('downloading');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await getStatus(taskId);
        const status = res.data.status;
        setDownloadStatus(status);
        if (status === 'downloaded' || status === 'download_failed') {
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [taskId]);

  const handleConfirm = async () => {
    setConfirming(true);
    setError('');
    try {
      await youtubeConfirm(taskId);
      setStep('processing');
    } catch (e) {
      setError('Failed to start processing. Please try again.');
      setConfirming(false);
    }
  };

  return (
    <Split title="Confirm">
      <div className="flex flex-col gap-6">
        <ErrorBanner message={error} onDismiss={() => setError('')} />

        {ytMeta && (
          <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
            {ytMeta.thumbnail && (
              <img src={ytMeta.thumbnail} alt={ytMeta.title} className="w-full max-w-[220px] shrink-0 object-cover" />
            )}
            <div className="flex min-w-0 flex-col gap-2">
              <h2 className="m-0 text-h3 font-light leading-tight">{ytMeta.title}</h2>
              <p className="m-0 text-caption text-muted">Duration {ytMeta.duration_formatted}</p>
            </div>
          </div>
        )}

        {downloadStatus === 'downloading' && (
          <p className="m-0 animate-pulse text-muted" role="status">
            Downloading audio from YouTube...
          </p>
        )}

        {downloadStatus === 'download_failed' && (
          <div className="flex flex-col items-center gap-4 md:items-start">
            <p className="m-0" role="alert">
              <span className="text-muted">Error — </span>Download failed. Please try again.
            </p>
            <TextButton onClick={() => setStep('upload')}>Go Back</TextButton>
          </div>
        )}

        {downloadStatus === 'downloaded' && (
          <>
            <p className="m-0 text-muted">Preview the audio to make sure this is the correct track.</p>
            <audio controls src={youtubePreviewUrl(taskId)} className="w-full" />
            <div className="flex items-baseline justify-center gap-6 pt-2 md:justify-start">
              <TextButton onClick={handleConfirm} disabled={confirming} className="text-h3">
                {confirming ? 'Starting...' : 'Confirm & Split'}
              </TextButton>
              <TextButton muted onClick={() => setStep('upload')}>
                Cancel
              </TextButton>
            </div>
          </>
        )}
      </div>
    </Split>
  );
}
