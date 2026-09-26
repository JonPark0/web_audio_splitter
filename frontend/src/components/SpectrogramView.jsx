import React, { useState } from 'react';
import { FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { spectrogramUrl } from '../api';
import ABToggle from './ABToggle';
import TextButton from './TextButton';

/**
 * Collapsible per-stem spectrogram, generated on demand by the backend
 * (/spectrogram) so the restored high-frequency content is visible, not
 * just claimed. Kept collapsed by default — rendering triggers an ffmpeg
 * call server-side, so we only pay for it when the user asks.
 */
export default function SpectrogramView({ taskId, trackName, hasRecovered }) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState('original');
  const Chevron = open ? FiChevronUp : FiChevronDown;

  return (
    <div className="w-full pb-4">
      <TextButton
        muted
        current={open}
        label="Spectrogram"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-caption"
      >
        <span className="inline-flex items-center gap-2">
          <span>Spectrogram</span>
          <Chevron className="icon" strokeWidth={1.5} aria-hidden="true" />
        </span>
      </TextButton>

      {open && (
        <div className="flex flex-col gap-3 pt-4">
          {hasRecovered && <ABToggle name={`spec-${trackName}`} variant={variant} onChange={setVariant} />}
          <figure className="m-0">
            <img
              key={`${trackName}-${variant}`}
              src={spectrogramUrl(taskId, trackName, variant)}
              alt={`${trackName} spectrogram (${variant})`}
              className="block h-auto w-full"
              loading="lazy"
            />
            <figcaption className="mt-2 text-center text-caption text-muted">
              {trackName.replace('.wav', '')} · {variant}
            </figcaption>
          </figure>
        </div>
      )}
    </div>
  );
}
