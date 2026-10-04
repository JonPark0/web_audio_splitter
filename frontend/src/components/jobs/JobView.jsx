import React, { Suspense, lazy, useEffect, useState } from 'react';
import { deleteTask, errorDetail, getStatus, getTasks, isTaskGone } from '../../api';
import { href, navigate } from '../../router';
import ProcessingScreen from '../ProcessingScreen';
import RetryPanel from '../RetryPanel';
import TextButton from '../TextButton';
import YouTubeConfirmScreen from '../YouTubeConfirmScreen';
import usePoll from '../shell/usePoll';
import { estimate, useEtaCalibration } from './eta';
import { RETRYABLE, STATUS_LABELS, TERMINAL, jobName } from './format';
import JobsPane from './JobsPane';
import { jobsChanged, publishFromTasks } from './jobsStore';

// The result screen pulls in the mixer + wavesurfer: its own chunk,
// prefetched while the job is still running.
const loadResultScreen = () => import('../ResultScreen');
const ResultScreen = lazy(loadResultScreen);

const BASE_TITLE = 'Audio Splitter';

function intervalFor(data) {
  if (data === 'gone') return null;
  if (!data) return 4000; // network trouble: keep trying, gently
  if (TERMINAL.has(data.status)) return null;
  if (data.status === 'downloaded') return 5000; // waiting for the user
  if (data.status === 'downloading') return 1500;
  return 2000;
}

function BackLink() {
  return (
    <a href={href('/split')} data-label="← Jobs" className="link self-start text-caption">
      ← Jobs
    </a>
  );
}

/**
 * /split/job/<id>: one job, whatever state it's in. Resolves /status at
 * once and polls until the job ends:
 * downloading / downloaded → YouTube confirm; queued / processing /
 * restoring → progress; completed → the stems (ResultScreen);
 * failed / cancelled / download_failed → why, Retry, Delete; unknown id →
 * "no longer exists". The tab title follows the progress.
 */
export default function JobView({ taskId }) {
  const [task, setTask] = useState(null);
  const [gone, setGone] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [retrying, setRetrying] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [extra, setExtra] = useState(null); // { name, model } from /tasks for old servers
  const calib = useEtaCalibration();

  const refresh = usePoll(
    async (ctx) => {
      try {
        const res = await getStatus(taskId);
        if (ctx.stale()) return undefined;
        setTask(res.data);
        setLoadError('');
        setNow(Date.now());
        return res.data;
      } catch (e) {
        if (ctx.stale()) return undefined;
        if (isTaskGone(e)) {
          setGone(true);
          return 'gone';
        }
        setLoadError(errorDetail(e, 'Could not reach the server.'));
        return undefined;
      }
    },
    intervalFor,
    [taskId]
  );

  const status = task?.status;
  const running = status === 'queued' || status === 'processing' || status === 'restoring';

  // Tick the elapsed / remaining clock between polls.
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  useEffect(() => {
    if (running || status === 'downloading' || status === 'downloaded') loadResultScreen().catch(() => {});
  }, [running, status]);

  // When the job ends, let the badge and the jobs list know right away.
  useEffect(() => {
    if (status && TERMINAL.has(status)) jobsChanged();
  }, [status]);

  // Older servers' /status lacks the name and model: look them up once.
  useEffect(() => {
    if (!task || (task.model && (task.source_name || task.title)) || extra) return undefined;
    let alive = true;
    getTasks({ limit: 200 })
      .then((res) => {
        if (!alive) return;
        publishFromTasks(res.data);
        const row = (res.data.tasks || []).find((t) => t.task_id === taskId);
        setExtra({ name: row?.name || null, model: row?.model || null });
      })
      .catch(() => alive && setExtra({ name: null, model: null }));
    return () => {
      alive = false;
    };
  }, [task, extra, taskId]);

  const merged = task ? { ...task, model: task.model || extra?.model, name: task.title || task.source_name || extra?.name } : null;
  const name = merged ? jobName(merged) : 'Job';

  // Tab title: "42% · full_song — Audio Splitter" while it runs.
  useEffect(() => {
    if (gone) {
      document.title = `Job not found — ${BASE_TITLE}`;
      return;
    }
    if (!merged) return;
    const short = name.replace(/\.[a-z0-9]{2,5}$/i, '');
    let prefix = '';
    if (merged.status === 'queued') prefix = 'Queued · ';
    else if (merged.status === 'downloading')
      prefix = Number.isFinite(merged.download_percent) ? `${merged.download_percent}% · ` : 'Downloading · ';
    else if (merged.status === 'downloaded') prefix = 'Review · ';
    else if (running) {
      const est = estimate(merged, now, calib);
      prefix = est?.fraction != null ? `${Math.round(est.fraction * 100)}% · ` : `${STATUS_LABELS[merged.status]} · `;
    } else if (merged.status === 'failed' || merged.status === 'download_failed') prefix = 'Failed · ';
    else if (merged.status === 'cancelled') prefix = 'Cancelled · ';
    document.title = `${prefix}${short} — ${BASE_TITLE}`;
  });
  useEffect(() => () => {
    document.title = `Split — ${BASE_TITLE}`;
  }, []);

  if (gone) {
    return (
      <div className="flex flex-col gap-2 py-4">
        <h1 className="m-0 text-h3 font-light">This job no longer exists</h1>
        <p className="m-0 text-muted">It may have been deleted, or the link is wrong.</p>
        <a href={href('/split')} data-label="Go to Jobs" className="link self-start">
          Go to Jobs
        </a>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <Suspense fallback={<p className="m-0 py-4 text-caption text-muted">Loading stems...</p>}>
        <ResultScreen taskId={taskId} />
      </Suspense>
    );
  }

  const remove = async () => {
    setDeleting(true);
    setActionError('');
    try {
      await deleteTask(taskId);
      jobsChanged();
      navigate('/split', { replace: true });
    } catch (e) {
      setActionError(errorDetail(e, 'Could not delete this job.'));
      setDeleting(false);
    }
  };

  const ended = status === 'failed' || status === 'cancelled' || status === 'download_failed';

  // Desktop: the job on the left, the live jobs list on the right (switch
  // jobs without going back); below it on smaller screens.
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 2xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="lg:border-r lg:border-line">
        <div className="flex flex-col gap-3 py-3 sm:py-4 lg:sticky lg:top-12 lg:pr-8">
          <div className="flex flex-col gap-1">
            <BackLink />
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0">
              <h1 className="m-0 min-w-0 break-words text-h3 font-light">{name}</h1>
              {merged && <span className="text-caption text-muted">{STATUS_LABELS[merged.status] || merged.status}</span>}
            </div>
          </div>

          {loadError && (
            <p className="m-0 text-caption" role="alert">
              <span className="text-muted">Error — </span>
              {loadError} Retrying...
            </p>
          )}

          {!merged && !loadError && <p className="m-0 text-caption text-muted">Loading...</p>}

          {merged && (status === 'downloading' || status === 'downloaded') && (
            <YouTubeConfirmScreen taskId={taskId} task={merged} onChanged={refresh} />
          )}

          {merged && running && (
            <ProcessingScreen taskId={taskId} task={merged} now={now} calib={calib} onChanged={refresh} />
          )}

          {merged && ended && (
            <div className="flex flex-col gap-3">
              <p className="m-0" role="alert">
                <span className="text-muted">{status === 'cancelled' ? 'Cancelled' : 'Failed'} — </span>
                {merged.error && merged.error !== 'Cancelled'
                  ? merged.error
                  : status === 'cancelled'
                  ? 'The job was stopped before it finished.'
                  : 'No reason was recorded.'}
              </p>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                {RETRYABLE.has(status) && (
                  <TextButton current={retrying} aria-expanded={retrying} onClick={() => setRetrying((r) => !r)}>
                    Retry
                  </TextButton>
                )}
                {confirmDelete ? (
                  <>
                    <span className="text-caption">Delete this job and its files? Library samples are kept.</span>
                    <TextButton onClick={remove} disabled={deleting}>
                      {deleting ? 'Deleting...' : 'Delete'}
                    </TextButton>
                    <TextButton onClick={() => setConfirmDelete(false)} disabled={deleting}>
                      Keep
                    </TextButton>
                  </>
                ) : (
                  <TextButton onClick={() => setConfirmDelete(true)}>Delete</TextButton>
                )}
                {status === 'download_failed' && (
                  <a href={href('/split')} data-label="Try another link" className="link">
                    Try another link
                  </a>
                )}
              </div>
              {actionError && (
                <p className="m-0 text-caption" role="alert">
                  <span className="text-muted">Error — </span>
                  {actionError}
                </p>
              )}
              {retrying && (
                <RetryPanel
                  className="border-t border-line pt-2"
                  taskId={taskId}
                  initialModel={merged.model}
                  initialRecover={merged.recover}
                  initialRecoveryModel={merged.recovery_model}
                  onStarted={(t) => {
                    jobsChanged();
                    navigate(`/split/job/${t.task_id}`);
                  }}
                  onCancel={() => setRetrying(false)}
                />
              )}
            </div>
          )}
        </div>
      </div>
      <JobsPane currentId={taskId} className="pb-6 max-lg:mt-2" />
    </div>
  );
}
