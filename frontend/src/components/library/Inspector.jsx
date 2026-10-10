import React, { useEffect, useState } from 'react';
import { getTasks } from '../../api';
import { href } from '../../router';
import { sampleAudioUrl } from '../../samplesApi';
import TextButton from '../TextButton';
import BpmControl from './BpmControl';
import DeleteControl from './DeleteControl';
import KeyControl from './KeyControl';
import NameEditor from './NameEditor';
import RowError from './RowError';
import { PlayGlyph } from './SampleRow';
import TagEditor from './TagEditor';
import Waveform from './Waveform';
import { downloadName, formatDuration, formatSource } from './format';
import { COARSE } from './ui';

// task_id -> job name, from ONE /tasks request per session (cheap: names
// only matter for display, and a stale miss just hides the name).
let jobNames = null;
function loadJobNames() {
  if (!jobNames) {
    jobNames = getTasks({ limit: 200 })
      .then((res) => new Map((res.data?.tasks || []).map((t) => [t.task_id, t.name])))
      .catch(() => new Map());
  }
  return jobNames;
}

function useJobName(taskId) {
  const [name, setName] = useState(null);
  useEffect(() => {
    if (!taskId) return undefined;
    let live = true;
    loadJobNames().then((m) => live && setName(m.get(taskId) || null));
    return () => {
      live = false;
    };
  }, [taskId]);
  return taskId ? name : null;
}

const STATUS = { pending: 'Analyzing…', failed: 'Analysis failed', done: null };

/**
 * Every editor for one sample (L-series: editors left the rows): docked on
 * the right at >= 1280 px, in a bottom sheet below that.
 */
export default function Inspector({
  sample,
  busy,
  playing,
  loading,
  audioRef,
  camelot,
  allTags,
  error,
  confirming,
  project,
  ctx,
  onHide,
  keys = true,
}) {
  const jobName = useJobName(sample?.source?.task_id);

  if (!sample) {
    return (
      <div className="flex flex-col gap-3 py-3 text-caption">
        <p className="m-0 text-muted">Select a sample to edit it here.</p>
        {/* keyboard hints, unless there's only a touchscreen */}
        {keys && (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            {[
              ['↑ ↓', 'select (plays with Auto on)'],
              ['Space', 'play / stop'],
              ['Enter', 'rename'],
              ['Del', 'delete'],
              ['L', 'loop'],
              ['Shift-click', 'check a range'],
            ].map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="tabular-nums">{k}</dt>
                <dd className="m-0 text-muted">{v}</dd>
              </React.Fragment>
            ))}
          </dl>
        )}
      </div>
    );
  }

  const id = sample.id;
  const patch = (changes) => ctx.patch(id, changes);
  const taskId = sample.source?.task_id;
  const status = STATUS[sample.analysis_status];

  return (
    <div className="flex flex-col gap-2 py-2 sm:gap-3 sm:py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <NameEditor sample={sample} busy={busy} onPatch={patch} />
        </div>
        {onHide && (
          <TextButton muted onClick={onHide} className={`shrink-0 text-caption ${COARSE}`} title="Hide the inspector">
            Hide
          </TextButton>
        )}
      </div>

      <p className="m-0 -mt-2 text-caption text-muted">
        {formatSource(sample.source)}
        {jobName && <> · {jobName}</>}
      </p>

      <div className="flex items-center gap-2">
        <TextButton
          label=""
          onClick={() => ctx.togglePlay(sample)}
          aria-label={playing ? 'Stop' : 'Play'}
          aria-pressed={playing}
          current={playing}
          className={`h-8 w-8 shrink-0 justify-center text-h4 ${COARSE}`}
        >
          <PlayGlyph playing={playing} loading={loading} />
        </TextButton>
        <Waveform
          sampleId={id}
          points={360}
          playing={playing}
          audioRef={audioRef}
          onSeek={(r) => ctx.seek(sample, r)}
          className="h-11 min-w-0 flex-1 sm:h-14"
          label="Click to play from here"
        />
        <span className="w-14 shrink-0 text-right text-caption tabular-nums">{formatDuration(sample.duration_sec)}</span>
      </div>

      <BpmControl sample={sample} busy={busy} onPatch={patch} />
      <KeyControl sample={sample} busy={busy} onPatch={patch} camelot={camelot} />
      <TagEditor key={id} sample={sample} onPatch={patch} allTags={allTags} />

      <div className="flex flex-wrap items-baseline gap-x-4 text-caption">
        {status && (
          <span className="text-muted" role="status">
            {status}
          </span>
        )}
        <TextButton
          disabled={busy || sample.analysis_status === 'pending'}
          onClick={() => ctx.analyze(id)}
          title="Detect tempo and key again; values you set yourself are kept"
          className={COARSE}
        >
          Re-analyze
        </TextButton>
        <span className="text-muted">keeps your BPM/key</span>
      </div>

      <RowError error={error} onDismiss={() => ctx.dismissError(id)} />

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-line pt-3">
        <TextButton
          disabled={busy}
          onClick={() => ctx.addToArrange(sample)}
          title={project ? `New track in "${project.name}"` : 'Into a new project'}
          className={COARSE}
        >
          Add to Arrange
        </TextButton>
        {taskId && (
          <TextButton as="a" href={href(`/split/job/${taskId}`)} className={COARSE} title="Open the job this was cut from">
            Open in Split
          </TextButton>
        )}
        <TextButton
          as="a"
          href={sampleAudioUrl(sample)}
          download={downloadName(sample)}
          onClick={(e) => ctx.download(e, sample)}
          title={downloadName(sample)}
          className={COARSE}
        >
          Download
        </TextButton>
        <DeleteControl
          busy={busy}
          confirming={confirming}
          onConfirmingChange={(v) => ctx.setConfirming(v ? id : null)}
          onDelete={() => ctx.remove(id)}
        />
      </div>
      {project && <p className="m-0 -mt-2 text-caption text-muted">Arrange target: {project.name}</p>}
    </div>
  );
}
