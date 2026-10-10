import React from 'react';
import TextButton from '../TextButton';
import { PlayGlyph } from './SampleRow';
import { ToggleWord } from './Toolbar';
import Waveform from './Waveform';

/**
 * Phone bottom bar while a sample plays: stop, name over a waveform you can
 * tap to seek (the cards are too small for it), Loop and Sync - the touch
 * stand-ins for Space / click-to-seek / L.
 */
export default function NowPlaying({ sample, loading, audioRef, onStop, onSeek, loop, onLoop, sync, onSync, syncLabel }) {
  if (!sample) return null;
  return (
    // safe insets: a landscape phone's notch / rounded corners
    <div className="pl-safe-inset pr-safe-inset fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]">
      <div className="flex h-14 items-center gap-1 px-2">
        <TextButton label="" onClick={onStop} aria-label={`Stop ${sample.name}`} current className="h-11 w-11 shrink-0 justify-center text-h4">
          <PlayGlyph playing loading={loading} />
        </TextButton>
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <span className="truncate text-caption">{sample.name}</span>
          <Waveform sampleId={sample.id} points={160} playing audioRef={audioRef} onSeek={onSeek} className="h-6" label="Tap to seek" />
        </div>
        <ToggleWord on={loop} onClick={onLoop} className="px-1 text-caption">
          Loop
        </ToggleWord>
        <ToggleWord on={sync} onClick={onSync} className="px-1 text-caption">
          {syncLabel}
        </ToggleWord>
      </div>
    </div>
  );
}
