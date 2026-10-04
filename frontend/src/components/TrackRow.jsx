import React, { memo } from 'react';
import { FiMoreHorizontal } from 'react-icons/fi';
import { trackUrl } from '../api';
import ABToggle from './ABToggle';
import SpectrogramView from './SpectrogramView';
import TextButton from './TextButton';
import Fader from './result/Fader';
import Lane from './result/Lane';

export const ROW_COLUMNS = {
  desktop: '184px minmax(0,1fr) 92px',
  tablet: '152px minmax(0,1fr) 76px',
};

/**
 * One stem: label column (name, Mute, Solo, dB fader, O|R), the waveform lane
 * (+ its spectrogram when open, on the same time axis) and the actions
 * (Extract first, Download, Spectrum). Phone: a 44 px line (name, M, S, ⋯)
 * over a full-width waveform; the rest lives in the row's ⋯ sheet.
 */
export default memo(function TrackRow({
  taskId,
  track,
  label,
  derived,
  hasRecovered,
  jobHasRecovered,
  recoveryModel,
  variant,
  db,
  muted,
  soloed,
  audible,
  size,
  rowH,
  coarse,
  peaks,
  timeline,
  scale,
  selection,
  isTarget,
  markers,
  loadState,
  loadError,
  audioError,
  sampleRate,
  peakMax,
  specOpen,
  extractActive,
  onVariant,
  onDb,
  onMute,
  onSolo,
  onExtract,
  onSpec,
  onRetry,
  onMenu,
}) {
  const failed = loadState === 'error' || audioError;
  const status = failed ? (
    <div data-nogesture="" role="alert" className="absolute inset-0 z-[4] flex items-center gap-3 bg-paper/85 px-3 text-caption">
      <span className="min-w-0 truncate">
        <span className="text-muted">Error — </span>
        {audioError ? `audio didn't load (${audioError})` : loadError || "waveform didn't load"}
      </span>
      <TextButton onClick={() => onRetry(track)} className="rs-hit shrink-0">
        Retry
      </TextButton>
    </div>
  ) : loadState !== 'ready' ? (
    <div className="pointer-events-none absolute inset-0 flex items-center px-3 text-caption text-muted" role="status">
      Loading waveform…
    </div>
  ) : null;

  const laneH = size === 'phone' ? 56 : rowH;
  const lane = (
    <Lane
      track={track}
      variant={variant}
      peaks={peaks}
      timeline={timeline}
      height={laneH}
      scale={scale}
      dim={!audible}
      selection={selection}
      isTarget={isTarget}
      markers={markers}
      status={status}
      coarse={coarse}
      label={`${label} waveform`}
    />
  );
  const spec = specOpen ? (
    <SpectrogramView taskId={taskId} trackName={track} variant={variant} timeline={timeline} height={size === 'phone' ? 56 : 64} sampleRate={sampleRate} />
  ) : null;

  const mute = (
    <TextButton
      current={muted}
      aria-pressed={muted}
      onClick={() => onMute(track)}
      title={derived ? 'Mute (derived stems start muted: they repeat the other stems)' : 'Mute'}
      aria-label={`Mute ${label}`}
      data-label="M"
      className={`rs-hit ${muted ? '' : 'link--muted'} ${size === 'phone' ? 'h-11 min-w-11 justify-center' : ''}`}
    >
      M
    </TextButton>
  );
  const solo = (
    <TextButton
      current={soloed}
      aria-pressed={soloed}
      onClick={() => onSolo(track)}
      title="Solo"
      aria-label={`Solo ${label}`}
      data-label="S"
      className={`rs-hit ${soloed ? '' : 'link--muted'} ${size === 'phone' ? 'h-11 min-w-11 justify-center' : ''}`}
    >
      S
    </TextButton>
  );
  const nameEl = (
    <span className="flex min-w-0 items-baseline gap-2">
      <span className={`max-w-full shrink-0 truncate capitalize leading-5 ${audible ? '' : 'text-muted'}`} title={label}>
        {label}
      </span>
      {derived && (
        <span className="min-w-0 truncate text-[11px] leading-5 text-muted" title="A mix of the other stems — starts muted so nothing plays twice">
          derived
        </span>
      )}
      {!derived && peakMax != null && peakMax < 0.01 && (
        <span className="min-w-0 truncate text-[11px] leading-5 text-muted" title={`Peak ${(20 * Math.log10(Math.max(peakMax, 1e-6))).toFixed(0)} dBFS — the model found almost nothing for this stem`}>
          near silent
        </span>
      )}
    </span>
  );

  if (size === 'phone') {
    return (
      <div>
        <div className="flex h-11 items-center gap-1">
          <span className="min-w-0 flex-1">{nameEl}</span>
          {hasRecovered && <span className="text-caption text-muted">{variant === 'recovered' ? 'R' : 'O'}</span>}
          {mute}
          {solo}
          <button
            type="button"
            onClick={() => onMenu(track)}
            className="link flex h-11 w-11 items-center justify-center"
            aria-label={`${label}: extract, download, spectrogram, level`}
            title="More"
          >
            <FiMoreHorizontal className="icon" aria-hidden="true" />
          </button>
        </div>
        {lane}
        {spec}
      </div>
    );
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: ROW_COLUMNS[size] }}>
      <div className="flex min-w-0 flex-col justify-center gap-0.5 self-start py-1.5 pr-3" style={{ height: rowH }}>
        <div className="flex items-baseline justify-between gap-2">
          {nameEl}
          <span className="flex shrink-0 items-baseline gap-2.5 text-caption">
            {mute}
            {solo}
          </span>
        </div>
        {size === 'tablet' ? (
          // Touch fader is 44 px tall: fader and O|R share one line to keep 80 px rows.
          <div className="flex items-center gap-2">
            <Fader db={db} onChange={(v) => onDb(track, v)} label={label} className="flex-1" />
            {hasRecovered && (
              <span className="shrink-0 text-caption">
                <ABToggle compact variant={variant} onChange={(v) => onVariant(track, v)} recoveryModel={recoveryModel} />
              </span>
            )}
          </div>
        ) : (
          <>
            <Fader db={db} onChange={(v) => onDb(track, v)} label={label} />
            <div className="flex h-5 items-baseline text-caption">
              {hasRecovered ? (
                <ABToggle compact variant={variant} onChange={(v) => onVariant(track, v)} recoveryModel={recoveryModel} />
              ) : jobHasRecovered ? (
                <span className="text-muted" title="No recovered version of this stem">
                  Original
                </span>
              ) : null}
            </div>
          </>
        )}
      </div>
      <div className="min-w-0">
        {lane}
        {spec}
      </div>
      <div className="flex flex-col items-end justify-center gap-0.5 self-start pl-3 text-caption" style={{ height: rowH }}>
        <TextButton
          current={extractActive}
          aria-pressed={extractActive}
          onClick={() => onExtract(track)}
          title="Cut a sample from this stem (drag across its waveform)"
          className="rs-hit leading-5"
        >
          Extract
        </TextButton>
        <TextButton as="a" muted href={trackUrl(taskId, track, variant)} download title={`Download ${label} (${variant})`} className="rs-hit leading-5">
          Download
        </TextButton>
        <TextButton muted current={specOpen} aria-pressed={specOpen} onClick={() => onSpec(track)} title="Spectrogram on the same time axis" className="rs-hit leading-5">
          Spectrum
        </TextButton>
      </div>
    </div>
  );
});
