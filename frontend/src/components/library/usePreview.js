import { useCallback, useEffect, useRef, useState } from 'react';
import { sampleAudioUrl } from '../../samplesApi';

function release(audio) {
  audio.pause();
  audio.removeAttribute('src');
  audio.load(); // drops the buffered stream / open connection
}

/**
 * One shared Audio element for a whole sample list: starting a sample
 * replaces whatever was playing. Progress isn't tracked in React state -
 * the playing row's waveform reads the element on each animation frame, so
 * playback never re-renders the list.
 *
 * Arrange's sample browser uses { playingId, toggle, stop } - keep those.
 * Extra (Library): play(sample, { at }) starts at a 0..1 position, seek(r),
 * loop, loadingId (set while a time-stretched render is being prepared),
 * and getUrl(sample) to pick the source (e.g. a tempo-synced render).
 */
export default function usePreview({ onError, getUrl, loop = false } = {}) {
  const audioRef = useRef(null);
  const [playingId, setPlayingIdState] = useState(null);
  const [loadingId, setLoadingId] = useState(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const getUrlRef = useRef(getUrl);
  getUrlRef.current = getUrl;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  // Mirrored in a ref so `toggle` can stay stable (memoized rows don't all
  // re-render when playback moves) and sees double-clicks before a render.
  const playingIdRef = useRef(null);
  const setPlayingId = useCallback((id) => {
    playingIdRef.current = id;
    setPlayingIdState(id);
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.loop = loop;
  }, [loop]);

  // The "start at" jump waiting for the current source's metadata.
  const jumpRef = useRef(null);
  const dropJump = useCallback(() => {
    if (jumpRef.current) audioRef.current?.removeEventListener('loadedmetadata', jumpRef.current);
    jumpRef.current = null;
  }, []);

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('ended', () => {
        if (!audio.loop) setPlayingId(null);
      });
      // Pauses we didn't ask for - AirPods taken out, a media key, iOS
      // backgrounding the page - left the row "playing", so ▶ took two
      // taps. Our own switch to the next sample pauses too, but by the time
      // that event arrives play() has already un-paused the element.
      audio.addEventListener('pause', () => {
        if (!audio.paused) return;
        setPlayingId(null);
        setLoadingId(null);
      });
      audio.addEventListener('playing', () => setLoadingId(null));
      audio.addEventListener('error', () => {
        // Emptying src on stop can also land here; only report real failures.
        if (!audio.getAttribute('src')) return;
        setPlayingId(null);
        setLoadingId(null);
        onErrorRef.current?.('Could not play this sample');
      });
      audioRef.current = audio;
    }
    return audioRef.current;
  }, [setPlayingId]);

  const stop = useCallback(() => {
    dropJump();
    if (audioRef.current) release(audioRef.current);
    setPlayingId(null);
    setLoadingId(null);
  }, [dropJump, setPlayingId]);

  const play = useCallback(
    (sample, { at = 0 } = {}) => {
      const audio = getAudio();
      // A jump still waiting for the previous source would otherwise start
      // this sample at the earlier tap's position.
      dropJump();
      audio.pause();
      audio.loop = loopRef.current;
      audio.src = getUrlRef.current?.(sample) || sampleAudioUrl(sample);
      if (at > 0) {
        const jump = () => {
          jumpRef.current = null;
          if (Number.isFinite(audio.duration)) audio.currentTime = at * audio.duration;
        };
        jumpRef.current = jump;
        audio.addEventListener('loadedmetadata', jump, { once: true });
      }
      setPlayingId(sample.id);
      setLoadingId(sample.id);
      audio.play().catch((err) => {
        // AbortError = superseded by a newer play()/stop(); not a failure.
        if (err?.name === 'AbortError') return;
        if (playingIdRef.current === sample.id) setPlayingId(null);
        setLoadingId(null);
        onErrorRef.current?.('Could not play this sample');
      });
    },
    [dropJump, getAudio, setPlayingId]
  );

  const toggle = useCallback(
    (sample) => {
      if (playingIdRef.current === sample.id) stop();
      else play(sample);
    },
    [play, stop]
  );

  // Jump within the playing sample (0..1); returns false if nothing plays.
  const seek = useCallback((ratio) => {
    const audio = audioRef.current;
    if (!audio || !playingIdRef.current || !Number.isFinite(audio.duration)) return false;
    audio.currentTime = Math.max(0, Math.min(1, ratio)) * audio.duration;
    return true;
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) release(audioRef.current);
    };
  }, []);

  return { audioRef, playingId, loadingId, toggle, play, stop, seek, playingIdRef };
}
