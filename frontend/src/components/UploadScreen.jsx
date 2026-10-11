import React, { useEffect, useId, useRef, useState } from 'react';
import { RECOVERY_MODELS, SEPARATION_MODELS, errorDetail, youtubeDownload, youtubeInfo } from '../api';
import { isComposing } from '../keys';
import { href } from '../router';
import Field from './Field';
import RecoveryControls from './RecoveryControls';
import TextButton from './TextButton';
import WordToggle from './WordToggle';
import Hairline from './jobs/Hairline';
import ModelSelect from './jobs/ModelSelect';
import { formatMB } from './jobs/format';
import { jobsChanged } from './jobs/jobsStore';
import { DropWash, usePageFileDrop } from './jobs/PageDrop';
import {
  ACCEPT,
  VIDEO_ACCEPTED,
  addFiles,
  cancelUploads,
  isActive,
  removeItem,
  retryItem,
  startUploads,
  takeDropReport,
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

// "a, b, c and 2 more"
const someNames = (names) => names.slice(0, 3).join(', ') + (names.length > 3 ? ` and ${names.length - 3} more` : '');

// Enter that confirms an IME composition must not submit the form.
const holdComposingEnter = (e) => {
  if (e.key === 'Enter' && isComposing(e)) e.preventDefault();
};

function itemStateText(item) {
  switch (item.state) {
    case 'waiting':
      return 'Waiting';
    case 'uploading':
      if (item.reconnecting) return `Reconnecting... · ${formatMB(item.loaded)} / ${formatMB(item.total)} MB`;
      return `${formatMB(item.loaded)} / ${formatMB(item.total)} MB${item.rate ? ` · ${formatMB(item.rate)} MB/s` : ''}`;
    case 'paused':
      return `Paused · ${formatMB(item.loaded)} / ${formatMB(item.total)} MB`;
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
 * progress, resume after a dropped connection and can be cancelled; every
 * file becomes its own job in the jobs list next to it. Settings are
 * remembered between visits. Files can be dropped anywhere on the page (on
 * a job page too: see jobs/PageDrop). On phones the CTA is a fixed bottom bar;
 * `onBarHeight(px)` reports its height (0 when it isn't fixed) so the page
 * can pad for it.
 */
export default function UploadScreen({ onBarHeight }) {
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

  const items = useUploadQueue();
  const fileId = useId();
  const urlId = useId();
  const urlRef = useRef(null);
  const statusRef = useRef(null);
  const barRef = useRef(null);

  useEffect(() => {
    saveSettings({ inputMode, model, recover, recoveryModel, autoSplit });
  }, [inputMode, model, recover, recoveryModel, autoSplit]);

  const active = items.find(isActive);
  const uploading = items.some((i) => isActive(i) || i.state === 'waiting');
  const ready = items.filter((i) => i.state === 'ready');
  const locked = uploading || !!ytBusy;

  // What became of added files (see addFiles).
  const reportAdded = ({ added, rejected, tooBig, maxMB }) => {
    if (added) {
      setInputMode('file');
      setMessage(null);
    }
    const skipped = [];
    if (rejected.length) {
      skipped.push(
        `Skipped ${rejected.length === 1 ? 'a file that isn’t' : `${rejected.length} files that aren’t`} audio${
          VIDEO_ACCEPTED ? ' or video' : ''
        }: ${someNames(rejected)}`
      );
    }
    // Over the server's limit: say so now, not after minutes of uploading.
    if (tooBig.length) {
      skipped.push(
        `Skipped ${tooBig.length === 1 ? 'a file' : `${tooBig.length} files`} over the ${maxMB} MB limit: ${someNames(tooBig)}`
      );
    }
    if (skipped.length) setError(skipped.join('. '));
    else if (added) setError('');
  };
  const takeFiles = (fileList) => reportAdded(addFiles(fileList));

  // Page-wide drop target.
  const dragging = usePageFileDrop(takeFiles);

  // Files dropped on a job page brought us here: say what became of them.
  useEffect(() => {
    const report = takeDropReport();
    if (report) reportAdded(report);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On phones the status sits in the bottom bar; make sure an error there
  // is actually seen (and read out).
  useEffect(() => {
    if (error) statusRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);

  // The phone bar's real height (it grows with a two-line status, larger
  // text or the home-indicator inset), for the page's bottom padding.
  const onBarHeightRef = useRef(onBarHeight);
  onBarHeightRef.current = onBarHeight;
  useEffect(() => {
    const el = barRef.current;
    if (!el || !onBarHeightRef.current) return undefined;
    const report = () =>
      onBarHeightRef.current?.(getComputedStyle(el).position === 'fixed' ? Math.ceil(el.getBoundingClientRect().height) : 0);
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const barFixed = () => !!barRef.current && getComputedStyle(barRef.current).position === 'fixed';

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
        text: 'Downloading',
        name: info.data.title,
        note: autoSplit ? 'it splits when the download is done.' : 'review it once it’s in.',
        href: href(`/split/job/${dl.data.task_id}`),
      });
      setYoutubeUrl('');
      // close the phone keyboard: the outcome is in the bottom bar under it
      urlRef.current?.blur();
      jobsChanged();
    } catch (e) {
      setError(errorDetail(e, 'Could not fetch that link.'));
      // on phones the error is in that bar too; on wider screens keep the
      // field focused for fixing the link (or put it there, when the CTA
      // that was clicked went disabled and dropped focus to the page)
      const el = document.activeElement;
      if (barFixed()) urlRef.current?.blur();
      else if (!el || el === document.body || el.matches('[data-cta]')) urlRef.current?.focus();
    } finally {
      setYtBusy('');
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    if (inputMode === 'file') submitFiles();
    else submitYoutube();
  };

  // A finished batch: say what happened, failures included, until the next
  // files are picked (the latest batch only — failed rows of an earlier
  // batch stay listed until retried or removed).
  const ended = items.filter((i) => i.state === 'done' || i.state === 'error');
  const lastBatch = Math.max(0, ...ended.map((i) => i.batch || 0));
  const batchItems = ended.filter((i) => i.batch === lastBatch);
  const doneItems = batchItems.filter((i) => i.state === 'done');
  const failedItems = batchItems.filter((i) => i.state === 'error');
  const jobHref = (item) => href(`/split/job/${item.taskId}`);
  let batchSummary = null;
  if (!uploading && !ready.length && batchItems.length) {
    const failed = failedItems.length;
    if (doneItems.length === 1 && !failed) batchSummary = { text: 'Queued', name: doneItems[0].file.name, href: jobHref(doneItems[0]) };
    else if (doneItems.length) {
      batchSummary = {
        text: `${doneItems.length} ${doneItems.length === 1 ? 'job' : 'jobs'} queued${failed ? `, ${failed} failed` : ''}.`,
        href: doneItems.length === 1 ? jobHref(doneItems[0]) : null,
      };
    } else if (failed === 1) batchSummary = { text: 'Failed', name: failedItems[0].file.name, note: failedItems[0].error };
    else batchSummary = { text: `${failed} files failed.` };
  }

  let ctaLabel;
  if (inputMode === 'youtube') ctaLabel = ytBusy ? 'Fetching...' : autoSplit ? 'Download & split' : 'Download';
  else ctaLabel = uploading ? 'Uploading...' : ready.length > 1 ? `Split ${ready.length} files` : 'Split';
  const canSubmit =
    inputMode === 'youtube' ? !!youtubeUrl.trim() && !ytBusy : ready.length > 0 && !uploading;

  const batchTotal = active ? items.filter((i) => i.batch === active.batch).length : 0;
  const batchIndex = active ? items.filter((i) => i.batch === active.batch && (i.state === 'done' || i.state === 'error')).length + 1 : 0;
  const progressValue = active ? (active.total ? Math.min(1, active.loaded / active.total) : 'indeterminate') : ytBusy ? 'indeterminate' : null;
  // Nothing left to stop once the last file is committed (it is on the
  // server already and becomes a job either way).
  const canCancel = uploading && !(active?.committed && !items.some((i) => i.state === 'waiting'));

  // Numbers and links before names, so the phone bar's two-line clamp only
  // ever cuts a long file or video title (the explanation after a title
  // waits for wider screens).
  let statusLine = null;
  let statusHref = null;
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
        {itemStateText(active)} · <span className="break-words">{active.file.name}</span>
      </span>
    );
  } else if (ytBusy) {
    statusLine = <span>{ytBusy}</span>;
  } else if (message || batchSummary) {
    const m = message || batchSummary;
    statusHref = m.href;
    statusLine = (
      <span>
        {m.text}
        {m.name && (
          <>
            {' '}
            <span className="break-words">“{m.name}”</span>
          </>
        )}
        {m.note && <span className="max-sm:hidden"> — {m.note}</span>}
        {/* on phones Open sits beside the status, out of the clamp */}
        {m.href && (
          <span className="max-sm:hidden">
            {' '}
            <a href={m.href} data-label="Open" className="link">
              Open
            </a>
          </span>
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
                  <span className="coarse:hidden">Drop audio files or choose</span>
                  <span className="hidden coarse:inline">Choose audio files</span>
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
                    {((item.state === 'error' && item.retryable) || item.state === 'paused') && (
                      <TextButton
                        className="shrink-0"
                        label="Retry"
                        aria-label={`Retry ${item.file.name}${item.state === 'paused' ? ' now' : ''}`}
                        onClick={() => retryItem(item.key)}
                      >
                        Retry
                      </TextButton>
                    )}
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
                    {item.state === 'paused' && (
                      <span className="basis-full pb-1">
                        <span className="text-muted">Upload paused — </span>
                        {item.error} It resumes where it stopped, by itself or on Retry.
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {uploading && (
              <p className="m-0 hidden text-caption coarse:block">Keep this screen on until the upload finishes.</p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-1">
            <Field inline label="Link" htmlFor={urlId}>
              {/* Busy while checking, but read-only rather than disabled: a
                  disabled field drops focus to the page, and after a refused
                  link it should still be there for fixing. */}
              <input
                ref={urlRef}
                id={urlId}
                type="url"
                inputMode="url"
                enterKeyHint="go"
                autoComplete="off"
                spellCheck={false}
                placeholder="https://www.youtube.com/watch?v=..."
                value={youtubeUrl}
                readOnly={!!ytBusy}
                aria-disabled={ytBusy ? 'true' : undefined}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                onKeyDown={holdComposingEnter}
                className={`ainput ${ytBusy ? 'text-muted' : ''}`}
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
            carries upload progress and errors, so it's always in reach. Its
            sides clear a landscape notch (as .px-safe does). */}
        <div
          ref={barRef}
          className="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-30 max-sm:border-t max-sm:border-line max-sm:bg-paper max-sm:pb-[env(safe-area-inset-bottom)] max-sm:pl-[max(1rem,env(safe-area-inset-left))] max-sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pt-1"
        >
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
                <TextButton onClick={cancelUploads} disabled={!canCancel} className="max-sm:hidden">
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
              <TextButton onClick={cancelUploads} disabled={!canCancel} className="shrink-0 sm:hidden" label="Cancel">
                Cancel
              </TextButton>
            )}
            {statusHref && (
              <a href={statusHref} data-label="Open" className="link shrink-0 sm:hidden">
                Open
              </a>
            )}
          </div>
        </div>
      </div>

      {dragging && <DropWash />}
    </form>
  );
}
