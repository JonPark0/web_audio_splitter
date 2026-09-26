import React from 'react';
import Mixer from './Mixer';
import TextButton from './TextButton';
import ReturnIcon from './ReturnIcon';

export default function ResultScreen({ taskId, result, setStep }) {
  const tracks = result?.tracks || [];
  const recoveredTracks = result?.recovered_tracks || [];

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
        <div className="mt-6">
          <TextButton label="New File" onClick={() => setStep('upload')}>
            <span className="inline-flex items-center gap-2">
              <ReturnIcon />
              <span>New File</span>
            </span>
          </TextButton>
        </div>
      </div>

      <Mixer taskId={taskId} tracks={tracks} recoveredTracks={recoveredTracks} />
    </div>
  );
}
