import React, { Suspense, lazy, useEffect, useState } from 'react';
import UploadScreen from './components/UploadScreen';
import YouTubeConfirmScreen from './components/YouTubeConfirmScreen';
import ProcessingScreen from './components/ProcessingScreen';
import RecentJobs from './components/RecentJobs';
import TextButton from './components/TextButton';

// The result screen pulls in the mixer + wavesurfer.js, which the upload flow
// never needs, so it ships as its own chunk (prefetched while processing).
const loadResultScreen = () => import('./components/ResultScreen');
const ResultScreen = lazy(loadResultScreen);
const LibraryScreen = lazy(() => import('./components/library/LibraryScreen'));
const ArrangeScreen = lazy(() => import('./arrange/ui/ArrangeScreen'));

const MODES = [
  { key: 'split', label: 'Split' },
  { key: 'library', label: 'Library' },
  { key: 'arrange', label: 'Arrange' },
];

const STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'youtube_confirm', label: 'Confirm' },
  { key: 'processing', label: 'Processing' },
  { key: 'result', label: 'Stems' },
];

const REPO_URL = 'https://github.com/JonPark0/web_audio_splitter';

function App() {
  // Top-level area; the Split flow keeps its own step state while the user
  // visits the Library, so switching back resumes where they left off.
  const [mode, setMode] = useState('split');
  const [step, setStep] = useState('upload'); // upload, youtube_confirm, processing, result
  const [taskId, setTaskId] = useState(null);
  const [ytMeta, setYtMeta] = useState(null);
  const [result, setResult] = useState(null);
  const [recoveryState, setRecoveryState] = useState({ recover: false, recoveryModel: 'apollo' });
  // Settings of the job on screen, when known (RecentJobs rows and retries
  // carry them; /status and /result don't report the separation model), so
  // "Retry with other settings" can pre-select them.
  const [taskMeta, setTaskMeta] = useState(null);

  // Processing takes a while, so fetch the result chunk in the background
  // then; by the time it's needed it's cached and Suspense never shows.
  useEffect(() => {
    if (step === 'processing') loadResultScreen().catch(() => {});
  }, [step]);

  const openResult = (id, res, task) => {
    setTaskId(id);
    setResult(res);
    setTaskMeta(task ? { taskId: id, model: task.model } : null);
    setStep('result');
  };

  // Used for running jobs reopened from RecentJobs and for freshly started
  // retries (RecentJobs, ResultScreen, ProcessingScreen).
  const openProcessing = (task) => {
    setTaskId(task.task_id);
    setRecoveryState({ recover: !!task.recover, recoveryModel: task.recovery_model || 'apollo' });
    setTaskMeta(task.model ? { taskId: task.task_id, model: task.model } : null);
    setStep('processing');
  };

  const knownModel = taskMeta?.taskId === taskId ? taskMeta.model : undefined;

  const wide = mode !== 'split' || step === 'result';

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-content flex-none flex-wrap items-baseline justify-between gap-x-8 gap-y-4 px-edge pb-6 pt-8 max-md:justify-center">
        <div className="flex flex-col items-start max-md:items-center">
          <span className="font-brand text-h3 uppercase leading-none tracking-[-0.01em]">Audio Splitter</span>
          <span className="mt-1 text-caption text-muted">Split &amp; Recover</span>
        </div>
        <nav aria-label="Sections" className="flex gap-5 text-p">
          {MODES.map((m) => (
            <TextButton
              key={m.key}
              current={m.key === mode}
              aria-current={m.key === mode ? 'page' : undefined}
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </TextButton>
          ))}
        </nav>
      </header>

      <main className="w-full flex-[1_0_auto] pt-4">
        <div className={`mx-auto w-full px-edge ${wide ? 'max-w-wide' : 'max-w-content'}`}>
          {mode === 'library' && (
            <Suspense fallback={null}>
              <LibraryScreen />
            </Suspense>
          )}

          {mode === 'arrange' && (
            <Suspense fallback={null}>
              <ArrangeScreen />
            </Suspense>
          )}

          {mode === 'split' && (
            <>
              <nav aria-label="Steps" className="mb-2 flex gap-5 text-caption max-md:hidden">
                {STEPS.map((s) => (
                  <span
                    key={s.key}
                    aria-current={s.key === step ? 'step' : undefined}
                    className={s.key === step ? 'text-ink weight-up' : 'text-muted'}
                  >
                    {s.label}
                  </span>
                ))}
              </nav>
              {step === 'upload' && (
                <>
                  <UploadScreen
                    setStep={setStep}
                    setTaskId={setTaskId}
                    setYtMeta={setYtMeta}
                    setRecoveryState={setRecoveryState}
                  />
                  <RecentJobs onOpenResult={openResult} onOpenProcessing={openProcessing} />
                </>
              )}
              {step === 'youtube_confirm' && (
                <YouTubeConfirmScreen taskId={taskId} ytMeta={ytMeta} setStep={setStep} />
              )}
              {step === 'processing' && (
                <ProcessingScreen
                  key={taskId}
                  taskId={taskId}
                  recoveryState={recoveryState}
                  model={knownModel}
                  setStep={setStep}
                  setResult={setResult}
                  onRetried={openProcessing}
                />
              )}
              {step === 'result' && (
                <Suspense fallback={null}>
                  <ResultScreen
                    taskId={taskId}
                    result={result}
                    model={knownModel}
                    setStep={setStep}
                    onRetried={openProcessing}
                  />
                </Suspense>
              )}
            </>
          )}
        </div>
      </main>

      <footer className="mx-auto mt-40 w-full max-w-content flex-none px-edge pb-10 pt-6 text-center text-muted">
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
