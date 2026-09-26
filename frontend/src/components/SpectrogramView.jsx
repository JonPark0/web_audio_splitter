import React, { useState } from 'react';
import { spectrogramUrl } from '../api';
import ABToggle from './ABToggle';
import TextButton from './TextButton';

/**
 * Collapsible per-stem spectrogram, generated on demand by the backend
 * (/spectrogram) so the restored high-frequency content is visible, not
 * just claimed. Kept collapsed by default — rendering triggers an ffmpeg
 * call server-side, so we only pay for it when the user asks.
 * The disclosure is a word, like Palnarium's text-only <summary> menus -
 * open state shows as ink + the hover weight, no chevron.
 */
export default function SpectrogramView({ taskId, trackName, hasRecovered }) {
  const [open, setOpen] = useState(false);
  const [variant, setVariant] = useState('original');

  return (
    <div className="w-full pb-4">
      <TextButton muted current={open} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="text-caption">
        Spectrogram
      </TextButton>

      {open && (
        <div className="flex flex-col gap-3 pt-4">
          {hasRecovered && <ABToggle name={`spec-${trackName}`} variant={variant} onChange={setVariant} />}
          <figure className="m-0">
            <img
              key={`${trackName}-${variant}`}
              src={spectrogramUrl(taskId, trackName, variant)}
              alt={`${trackName} spectrogram (${variant})`}
              // ffmpeg paints a colour map on black; greyscale + invert turns
              // it into ink on paper (loud = dark) so no chroma reaches the UI.
              className="block h-auto w-full grayscale invert"
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
