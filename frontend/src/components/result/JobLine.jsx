import React, { useEffect, useRef, useState } from 'react';
import { FiDownload } from 'react-icons/fi';
import { stemsZipUrl } from '../../api';
import { href } from '../../router';
import TextButton from '../TextButton';
import { fmtDuration } from './format';

/** "Download all" — one zip per variant (a small menu when both exist). */
function DownloadAll({ taskId, recovered, compact }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const label = compact ? <FiDownload className="icon" aria-hidden="true" /> : 'Download all';
  if (!recovered) {
    return (
      <TextButton as="a" href={stemsZipUrl(taskId, 'original')} download aria-label="Download all stems (zip)" title="All stems as one zip" className="rs-hit" label={compact ? '' : undefined}>
        {label}
      </TextButton>
    );
  }
  return (
    <div ref={ref} className="relative">
      <TextButton
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Download all stems"
        onClick={() => setOpen((o) => !o)}
        current={open}
        className="rs-hit"
        label={compact ? '' : undefined}
      >
        {label}
      </TextButton>
      {open && (
        <div role="menu" className="absolute right-0 top-full z-40 mt-1 flex w-max flex-col gap-1 border border-line bg-paper px-3 py-2">
          <TextButton as="a" role="menuitem" href={stemsZipUrl(taskId, 'original')} download onClick={() => setOpen(false)} className="rs-hit items-start">
            Original stems (zip)
          </TextButton>
          <TextButton as="a" role="menuitem" href={stemsZipUrl(taskId, 'recovered')} download onClick={() => setOpen(false)} className="rs-hit items-start">
            Recovered stems (zip)
          </TextButton>
        </div>
      )}
    </div>
  );
}

/**
 * The job, in one 32 px line: name · model · stems · duration · tempo · key,
 * then Retry, Download all and ← Jobs.
 */
export default function JobLine({ taskId, result, bpm, songKey, duration, retrying, onRetry, phone }) {
  const stems = result.tracks?.length || 0;
  const model = result.model ? result.model + (result.recovered && result.recovery_model ? ` + ${result.recovery_model}` : '') : null;
  const meta = [
    model,
    `${stems} ${stems === 1 ? 'stem' : 'stems'}`,
    fmtDuration(duration),
    bpm ? `${Math.round(bpm * 10) / 10} BPM` : null,
    songKey,
  ].filter(Boolean);
  return (
    <div className="flex h-8 min-w-0 items-center gap-x-4 text-caption [@media(pointer:coarse)]:h-11">
      <h1 className="m-0 min-w-0 max-w-[50%] shrink-0 truncate text-p font-light leading-8" title={result.name}>
        {result.name || 'Stems'}
      </h1>
      <span className="min-w-0 flex-1 truncate text-muted" title={meta.join(' · ')}>
        {meta.join(' · ')}
      </span>
      <span className="flex shrink-0 items-center gap-x-4">
        <TextButton muted current={retrying} aria-expanded={retrying} onClick={onRetry} className="rs-hit" title="Run this job again with other settings">
          Retry
        </TextButton>
        <DownloadAll taskId={taskId} recovered={result.recovered} compact={phone} />
        <TextButton as="a" href={href('/split')} className="rs-hit" title="All jobs">
          ← Jobs
        </TextButton>
      </span>
    </div>
  );
}
