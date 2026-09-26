import React, { Suspense, lazy, useEffect, useState } from 'react';
import UploadScreen from './components/UploadScreen';
import YouTubeConfirmScreen from './components/YouTubeConfirmScreen';
import ProcessingScreen from './components/ProcessingScreen';
import TextButton from './components/TextButton';

// The result screen pulls in the mixer + wavesurfer.js, which the upload flow
// never needs, so it ships as its own chunk (prefetched while processing).
const loadResultScreen = () => import('./components/ResultScreen');
const ResultScreen = lazy(loadResultScreen);

const STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'youtube_confirm', label: 'Confirm' },
  { key: 'processing', label: 'Processing' },
  { key: 'result', label: 'Stems' },
];

const REPO_URL = 'https://github.com/JonPark0/web_audio_splitter';

function App() {
  const [step, setStep] = useState('upload'); // upload, youtube_confirm, processing, result
  const [taskId, setTaskId] = useState(null);
  const [ytMeta, setYtMeta] = useState(null);
  const [result, setResult] = useState(null);
  const [recoveryState, setRecoveryState] = useState({ recover: false, recoveryModel: 'apollo' });

  // Processing takes a while, so fetch the result chunk in the background
  // then; by the time it's needed it's cached and Suspense never shows.
  useEffect(() => {
    if (step === 'processing') loadResultScreen().catch(() => {});
  }, [step]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-content flex-none items-baseline justify-between gap-8 px-edge pb-6 pt-8 max-md:justify-center">
        <div className="flex flex-col items-start max-md:items-center">
          <span className="font-brand text-h3 uppercase leading-none tracking-[-0.01em]">Audio Splitter</span>
          <span className="mt-1 text-caption text-muted">Split &amp; Recover</span>
        </div>
        <nav aria-label="Steps" className="flex gap-5 max-md:hidden">
          {STEPS.map((s) => (
            <span
              key={s.key}
              aria-current={s.key === step ? 'step' : undefined}
              className={s.key === step ? 'text-ink [font-variation-settings:"wght"_400]' : 'text-muted'}
            >
              {s.label}
            </span>
          ))}
        </nav>
      </header>

      <main className="w-full flex-[1_0_auto] pt-4">
        <div className={`mx-auto w-full px-edge ${step === 'result' ? 'max-w-wide' : 'max-w-content'}`}>
          {step === 'upload' && (
            <UploadScreen
              setStep={setStep}
              setTaskId={setTaskId}
              setYtMeta={setYtMeta}
              setRecoveryState={setRecoveryState}
            />
          )}
          {step === 'youtube_confirm' && (
            <YouTubeConfirmScreen taskId={taskId} ytMeta={ytMeta} setStep={setStep} />
          )}
          {step === 'processing' && (
            <ProcessingScreen
              taskId={taskId}
              recoveryState={recoveryState}
              setStep={setStep}
              setResult={setResult}
            />
          )}
          {step === 'result' && (
            <Suspense fallback={null}>
              <ResultScreen taskId={taskId} result={result} setStep={setStep} />
            </Suspense>
          )}
        </div>
      </main>

      <footer className="mx-auto mt-24 w-full max-w-content flex-none px-edge pb-10 pt-6 text-center text-muted md:mt-40">
        <nav aria-label="Footer" className="mb-2 flex items-center justify-center gap-4">
          <TextButton as="a" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </TextButton>
          <span aria-hidden="true" className="text-line">
            |
          </span>
          <TextButton as="a" href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">
            Info
          </TextButton>
        </nav>
        <p className="m-0 text-caption">Demucs separation · Apollo / AudioSR / FlashSR restoration</p>
      </footer>
    </div>
  );
}

export default App;
