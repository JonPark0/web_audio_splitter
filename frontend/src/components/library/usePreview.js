import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleAudioUrl } from '../../samplesApi';

function release(audio) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load(); // drops the buffered stream / open connection
}

/**
 * One shared Audio element for the whole library: starting a sample replaces
 * whatever was playing. Progress isn't tracked here - the playing row's
 * PreviewProgress subscribes to the element itself, so ~4Hz timeupdates never
 * re-render the list.
 */
export default function usePreview({ onError } = {}) {
  const audioRef = useRef(null);
  const [playingId, setPlayingIdState] = useState(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Mirrored in a ref so `toggle` can stay stable (memoized rows don't all
  // re-render when playback moves) and sees double-clicks before a render.
  const playingIdRef = useRef(null);
  const setPlayingId = useCallback((id) => {
    playingIdRef.current = id;
    setPlayingIdState(id);
  }, []);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('ended', () => setPlayingId(null));
      audio.addEventListener('error', () => {
        // Emptying src on stop can also land here; only report real failures.
        if (!audio.getAttribute('src')) return;
        setPlayingId(null);
        onErrorRef.current?.('Could not play this sample');
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [setPlayingId]);

  const stop = useCallback(() => {
    if (audioRef.current) release(audioRef.current);
    setPlayingId(null);
  }, [setPlayingId]);

  const toggle = useCallback(
    (sample) => {
      if (playingIdRef.current === sample.id) {
        stop();
        return;
      }
      const audio = getAudio();
      audio.pause();
      audio.src = sampleAudioUrl(sample);
      setPlayingId(sample.id);
      audio.play().catch((err) => {
        // AbortError = superseded by a newer play()/stop(); not a failure.
        if (err?.name === 'AbortError') return;
        if (playingIdRef.current === sample.id) setPlayingId(null);
        onErrorRef.current?.('Could not play this sample');
      });
    },
    [getAudio, setPlayingId, stop]
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) release(audioRef.current);
    };
  }, []);

  return { audioRef, playingId, toggle, stop };
}
