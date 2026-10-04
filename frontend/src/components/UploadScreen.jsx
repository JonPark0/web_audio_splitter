import React, { useEffect, useId, useRef, useState } from 'react';
import { RECOVERY_MODELS, SEPARATION_MODELS, errorDetail, youtubeDownload, youtubeInfo } from '../api';
import { href } from '../router';
import Field from './Field';
import RecoveryControls from './RecoveryControls';
import TextButton from './TextButton';
import WordToggle from './WordToggle';
import Hairline from './jobs/Hairline';
import ModelSelect from './jobs/ModelSelect';
import { formatMB } from './jobs/format';
import { jobsChanged } from './jobs/jobsStore';
import {
  ACCEPT,
  VIDEO_ACCEPTED,
  addFiles,
  cancelUploads,
  isActive,
  removeItem,
  startUploads,
  useUploadQueue,
} from './jobs/uploadQueue';

const INPUT_MODES = [
  { value: 'file', label: 'File' },
  { value: 'youtube', label: 'YouTube' },
];
const AFTER_DOWNLOAD = [
  { value: 'split', label: 'Split' },
  { value: 'review', label: 'Review first' },
];

const SETTINGS_KEY = 'audioSplitter.newSplit';

function loadSettings() {
  try {
    return JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch (e) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    // private mode / storage full: settings just aren't remembered
  }
}

const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');

function itemStateText(item) {
  switch (item.state) {
    case 'waiting':
      return 'Waiting';
    case 'uploading':
      return `${formatMB(item.loaded)} / ${formatMB(item.total)} MB${item.rate ? ` · ${formatMB(item.rate)} MB/s` : ''}`;
    case 'checking':
      return 'Checking file...';
    case 'done':
      return 'Queued';
    case 'error':
      return item.error;
    default:
      return `${formatMB(item.file.size)} MB`;
  }
}

/**
 * "New split": source (files or a YouTube link), separation model,
 * restoration, and the CTA. Files upload one after another with byte
 * progress and can be cancelled; every file becomes its own job in the jobs
 * list next to it. Settings are remembered between visits. Files can be
 * dropped anywhere on the page.
 */
export default function UploadScreen() {
  const [saved] = useState(loadSettings);
  const [inputMode, setInputMode] = useState(saved.inputMode === 'youtube' ? 'youtube' : 'file');
  const [model, setModel] = useState(
    SEPARATION_MODELS.some((m) => m.value === saved.model) ? saved.model : 'htdemucs'
  );
  const [recover, setRecover] = useState(!!saved.recover);
  const [recoveryModel, setRecoveryModel] = useState(
    RECOVERY_MODELS.some((m) => m.value === saved.recoveryModel) ? saved.recoveryModel : 'apollo'
  );
  const [autoSplit, setAutoSplit] = useState(saved.autoSplit !== false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [ytBusy, setYtBusy] = useState(''); // progress words while fetching a link
  const [error, setError] = useState('');
  const [message, setMessage] = useState(null); // { text, href }
  const [dragging, setDragging] = useState(false);

  const items = useUploadQueue();
  const fileId = useId();
  const urlId = useId();
  const statusRef = useRef(null);

  useEffect(() => {
    saveSettings({ inputMode, model, recover, recoveryModel, autoSplit });
  }, [inputMode, model, recover, recoveryModel, autoSplit]);

  const active = items.find(isActive);
  const uploading = items.some((i) => isActive(i) || i.state === 'waiting');
  const ready = items.filter((i) => i.state === 'ready');
  const locked = uploading || !!ytBusy;

  const takeFiles = (fileList) => {
    const { added, rejected } = addFiles(fileList);
    if (added) {
      setInputMode('file');
      setMessage(null);
    }
    if (rejected.length) {
      const names = rejected.slice(0, 3).join(', ') + (rejected.length > 3 ? ` and ${rejected.length - 3} more` : '');
      setError(
        `Skipped ${rejected.length === 1 ? 'a file that isn’t' : `${rejected.length} files that aren’t`} audio${
          VIDEO_ACCEPTED ? ' or video' : ''
        }: ${names}`
      );
    } else if (added) {
      setError('');
    }
  };
  const takeFilesRef = useRef(takeFiles);
  takeFilesRef.current = takeFiles;

  // Page-wide drop target. An enter/leave counter keeps the wash steady
  // while the drag crosses child elements.
  useEffect(() => {
    let depth = 0;
    const reset = () => {
      depth = 0;
      setDragging(false);
    };
    const onEnter = (e) => {
      if (!isFileDrag(e)) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (e) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const onOver = (e) => {
      if (!isFileDrag(e) || e.defaultPrevented) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e) => {
      if (!isFileDrag(e) || e.defaultPrevented) return;
      e.preventDefault();
      reset();
      takeFilesRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
    };
  }, []);

  // On phones the status sits in the bottom bar; make sure an error there
  // is actually seen (and read out).
  useEffect(() => {
    if (error) statusRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

  const submitFiles = () => {
    if (!ready.length || uploading) return;
    setError('');
    setMessage(null);
    startUploads({ model, recover, recoveryModel });
  };

  const submitYoutube = async () => {
    const url = youtubeUrl.trim();
    if (!url || ytBusy) return;
    setError('');
    setMessage(null);
    setYtBusy('Checking the link...');
    try {
      // /youtube/info is where playlist / live / too-long links are refused.
      const info = await youtubeInfo(url);
      setYtBusy('Starting the download...');
      const dl = await youtubeDownload({ url, model, recover, recoveryModel, autoSplit });
      setMessage({
        text: `Downloading “${info.data.title}”${autoSplit ? ' — it splits when the download is done.' : ' — review it once it’s in.'}`,
        href: href(`/split/job/${dl.data.task_id}`),
      });
      setYoutubeUrl('');
      jobsChanged();
    } catch (e) {
      setError(errorDetail(e, 'Could not fetch that link.'));
    } finally {
      setYtBusy('');
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (inputMode === 'file') submitFiles();
    else submitYoutube();
  };

  // A finished batch: say what happened.
  const batchItems = items.filter((i) => i.state === 'done' || i.state === 'error');
  const doneItems = batchItems.filter((i) => i.state === 'done');
  const batchSummary =
    !uploading && doneItems.length
      ? {
          text:
            doneItems.length === 1
              ? `Queued “${doneItems[0].file.name}”.`
              : `${doneItems.length} jobs queued${batchItems.length > doneItems.length ? `, ${batchItems.length - doneItems.length} failed` : ''}.`,
          href: doneItems.length === 1 ? href(`/split/job/${doneItems[0].taskId}`) : null,
        }
      : null;

  let ctaLabel;
  if (inputMode === 'youtube') ctaLabel = ytBusy ? 'Fetching...' : autoSplit ? 'Download & split' : 'Download';
  else ctaLabel = uploading ? 'Uploading...' : ready.length > 1 ? `Split ${ready.length} files` : 'Split';
  const canSubmit =
    inputMode === 'youtube' ? !!youtubeUrl.trim() && !ytBusy : ready.length > 0 && !uploading;

  const batchTotal = active ? items.filter((i) => i.batch === active.batch).length : 0;
  const batchIndex = active ? items.filter((i) => i.batch === active.batch && (i.state === 'done' || i.state === 'error')).length + 1 : 0;
  const progressValue = active ? (active.total ? Math.min(1, active.loaded / active.total) : 'indeterminate') : ytBusy ? 'indeterminate' : null;

  let statusLine = null;
  if (error) {
    statusLine = (
      <span role="alert">
        <span className="text-muted">Error — </span>
        {error}
      </span>
    );
  } else if (active) {
    statusLine = (
      <span className="tabular-nums">
        {batchTotal > 1 ? `${batchIndex}/${batchTotal} · ` : ''}
        <span className="break-all">{active.file.name}</span> · {itemStateText(active)}
      </span>
    );
  } else if (ytBusy) {
    statusLine = <span>{ytBusy}</span>;
  } else if (message || batchSummary) {
    const m = message || batchSummary;
    statusLine = (
      <span>
        {m.text}{' '}
        {m.href && (
          <a href={m.href} data-label="Open" className="link">
            Open
          </a>
        )}
      </span>
    );
  } else if (inputMode === 'file') {
    statusLine = (
      <span className="text-muted">
        {ready.length ? `${ready.length} ${ready.length === 1 ? 'file' : 'files'} ready` : 'Add audio files first'}
      </span>
    );
  }

  return (
    <form
      noValidate
      onSubmit={onSubmit}
      aria-labelledby="new-split-heading"
      className="flex flex-col gap-2 sm:grid sm:grid-cols-2 sm:items-start sm:gap-x-8 lg:flex lg:items-stretch lg:gap-3"
    >
      {/* Source */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <h2 id="new-split-heading" className="m-0 text-h4 font-light">
            New split
          </h2>
          <WordToggle
            name="new-split-source"
            aria-label="Source"
            options={INPUT_MODES}
            value={inputMode}
            onChange={(v) => {
              setInputMode(v);
              setError('');
            }}
            disabled={locked}
          />
        </div>

        {inputMode === 'file' ? (
          <>
            <div>
              <input
                id={fileId}
                type="file"
                multiple
                accept={ACCEPT}
                className="peer sr-only"
                onChange={(e) => {
                  takeFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              {/* Text-only drop target (Palnarium's "Add New Image"): hairline
                  rules above and below, the one hover fill while hovered or
                  while a file is dragged over the page. */}
              <label
                htmlFor={fileId}
                className={`group flex h-12 cursor-pointer items-center justify-between gap-4 border-y sm:h-16 border-line px-3 transition-colors duration-140 hover:bg-wash peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink ${
                  dragging ? 'bg-wash' : ''
                }`}
              >
                <span data-label="Drop audio files or choose" className="link shrink-0 whitespace-nowrap group-hover:[--_w:400]">
                  <span className="[@media(pointer:coarse)]:hidden">Drop audio files or choose</span>
                  <span className="hidden [@media(pointer:coarse)]:inline">Choose audio files</span>
                </span>
                <span className="min-w-0 text-right text-caption leading-tight text-muted">
                  {VIDEO_ACCEPTED ? 'Audio or video' : 'Audio'} · several at once
                </span>
              </label>
            </div>

            {items.length > 0 && (
              <ul className="m-0 flex list-none flex-col p-0 text-caption" aria-label="Files">
                {items.map((item) => (
                  <li key={item.key} className="flex min-h-7 flex-wrap items-center gap-x-3">
                    <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                    {item.state !== 'error' && <span className="shrink-0 tabular-nums text-muted">{itemStateText(item)}</span>}
                    {item.state === 'done' && item.taskId ? (
                      <a href={href(`/split/job/${item.taskId}`)} data-label="Open" className="link shrink-0">
                        Open
                      </a>
                    ) : !isActive(item) ? (
                      <TextButton
                        className="shrink-0"
                        label="Remove"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() => removeItem(item.key)}
                      >
                        Remove
                      </TextButton>
                    ) : null}
                    {item.state === 'error' && (
                      <span className="basis-full pb-1">
                        <span className="text-muted">Failed — </span>
                        {item.error}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <Field inline label="Link" htmlFor={urlId}>
              <input
                id={urlId}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                disabled={!!ytBusy}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                className="ainput"
              />
            </Field>
            <Field inline label="After download" labelId={`${urlId}-after`}>
              <WordToggle
                name="new-split-after-download"
                aria-labelledby={`${urlId}-after`}
                options={AFTER_DOWNLOAD}
                value={autoSplit ? 'split' : 'review'}
                onChange={(v) => setAutoSplit(v === 'split')}
                disabled={!!ytBusy}
              />
            </Field>
            <p className="m-0 pl-[calc(5rem+0.75rem)] text-caption text-muted max-sm:hidden">
              {autoSplit
                ? 'Separation starts as soon as the audio is in.'
                : 'The job waits for you to preview the audio and confirm.'}{' '}
              One video, up to 30 minutes; no playlists or live streams.
            </p>
          </div>
        )}
      </div>

      {/* Settings + CTA */}
      <div className="flex min-w-0 flex-col gap-2 lg:gap-3">
        <ModelSelect value={model} onChange={setModel} disabled={locked} />
        <RecoveryControls
          recover={recover}
          setRecover={setRecover}
          recoveryModel={recoveryModel}
          setRecoveryModel={setRecoveryModel}
          disabled={locked}
        />

        {/* The CTA: inline from 640px; on phones a fixed bottom bar that also
            carries upload progress and errors, so it's always in reach. */}
        <div className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:border-t max-sm:border-line max-sm:bg-paper max-sm:px-4 max-sm:pb-[env(safe-area-inset-bottom)] sm:pt-1">
          <div className="relative flex min-h-14 items-center gap-x-4 sm:min-h-0 sm:flex-col sm:items-start sm:gap-y-1">
            {progressValue !== null && (
              <div className="max-sm:absolute max-sm:inset-x-0 max-sm:-top-px sm:order-last sm:w-full">
                <Hairline value={progressValue} label={active ? `Uploading ${active.file.name}` : 'Fetching'} />
              </div>
            )}
            <div className="flex shrink-0 items-center gap-x-5">
              <TextButton data-cta type="submit" disabled={!canSubmit} className="text-h4 sm:text-h3" label={ctaLabel}>
                {ctaLabel}
              </TextButton>
              {uploading && (
                <TextButton onClick={cancelUploads} className="max-sm:hidden">
                  Cancel upload
                </TextButton>
              )}
            </div>
            <div
              ref={statusRef}
              aria-live="polite"
              className="min-w-0 flex-1 text-caption max-sm:line-clamp-2 sm:w-full"
            >
              {statusLine}
            </div>
            {uploading && (
              <TextButton onClick={cancelUploads} className="shrink-0 sm:hidden" label="Cancel">
                Cancel
              </TextButton>
            )}
          </div>
        </div>
      </div>

      {dragging && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-40 flex flex-col items-center justify-center gap-1 bg-wash/95"
        >
          <p className="m-0 text-h3">Drop to add audio files</p>
          <p className="m-0 text-caption text-muted">Each file becomes its own job.</p>
        </div>
      )}
    </form>
  );
}
