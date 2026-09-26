import React, { memo, useCallback, useState } from 'react';
import { FiDownload, FiPlay, FiSquare } from 'react-icons/fi';
import { sampleAudioUrl } from '../../samplesApi';
import TextButton from '../TextButton';
import BpmControl from './BpmControl';
import DeleteControl from './DeleteControl';
import KeyControl from './KeyControl';
import NameEditor from './NameEditor';
import PreviewProgress from './PreviewProgress';
import TagEditor from './TagEditor';
import { downloadName, formatDuration, formatSource } from './format';

// Memoized: the screen re-fetches every 2s while analysis runs, and it keeps
// unchanged sample objects identical so only rows that changed re-render.
export default memo(function SampleRow({ sample, playing, audioRef, onTogglePlay, onPatch, onAnalyze, onDelete }) {
  // Controls lock while this row has a request in flight, so e.g. a fast
  // double x2 can't apply twice to the same stale BPM. A counter, since two
  // requests can overlap (e.g. tag Enter then BPM blur).
  const [inFlight, setInFlight] = useState(0);
  const busy = inFlight > 0;

  const run = useCallback(async (fn) => {
    setInFlight((n) => n + 1);
    try {
      await fn();
    } finally {
      setInFlight((n) => n - 1);
    }
  }, []);

  const patch = useCallback((changes) => run(() => onPatch(sample.id, changes)), [run, onPatch, sample.id]);

  const status = sample.analysis_status;

  return (
    <div className="border-t border-line py-5">
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:gap-x-8 md:gap-y-5 xl:flex-nowrap">
        <div className="flex min-w-0 items-start gap-4 md:basis-full xl:flex-1 xl:basis-0">
          <TextButton
            onClick={() => onTogglePlay(sample)}
            label=""
            aria-label={playing ? `Stop ${sample.name}` : `Play ${sample.name}`}
            aria-pressed={playing}
            title={playing ? 'Stop' : 'Play'}
            current={playing}
            className="mt-0.5 shrink-0 text-h3"
          >
            {playing ? (
              <FiSquare className="icon" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <FiPlay className="icon" strokeWidth={1.5} aria-hidden="true" />
            )}
          </TextButton>

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <NameEditor sample={sample} busy={busy} onPatch={patch} />
            <p className="m-0 break-words text-caption text-muted">
              <span className="tabular-nums">{formatDuration(sample.duration_sec)}</span>
              {' · '}
              {formatSource(sample.source)}
            </p>
            {status === 'pending' && (
              <p className="m-0 text-caption text-muted" role="status">
                Analyzing…
              </p>
            )}
            {status === 'failed' && (
              <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-caption">
                <span className="text-muted">Analysis failed</span>
                <TextButton disabled={busy} onClick={() => run(() => onAnalyze(sample.id))}>
                  Re-analyze
                </TextButton>
              </p>
            )}
            {/* Height reserved on every row so starting playback doesn't shift the list. */}
            <div className="mt-2 h-px">{playing && <PreviewProgress audioRef={audioRef} duration={sample.duration_sec} />}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-x-8 gap-y-4 xl:w-[26rem] xl:shrink-0">
          <BpmControl sample={sample} busy={busy} onPatch={patch} />
          <KeyControl sample={sample} busy={busy} onPatch={patch} />
        </div>

        <div className="min-w-0 md:flex-1 xl:w-56 xl:flex-none">
          <TagEditor sample={sample} busy={busy} onPatch={patch} />
        </div>

        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-caption md:shrink-0 xl:w-44 xl:justify-end">
          <TextButton
            as="a"
            href={sampleAudioUrl(sample)}
            download={downloadName(sample.name)}
            label="Download"
            title="Download WAV"
          >
            <span className="inline-flex items-center gap-2">
              <FiDownload className="icon" strokeWidth={1.5} aria-hidden="true" />
              <span>Download</span>
            </span>
          </TextButton>
          <DeleteControl busy={busy} onDelete={() => run(() => onDelete(sample.id))} />
        </div>
      </div>
    </div>
  );
});
