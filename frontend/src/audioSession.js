/**
 * iOS plays Web Audio in the "ambient" audio session, which the ringer /
 * silent switch mutes: with the phone on silent, Play moved the playhead in
 * silence while sample previews (plain <audio>, a "playback" session) were
 * audible. Both engines call these from their play/pause paths.
 *
 * - Safari 16.4+ exposes navigator.audioSession: asking for 'playback' routes
 *   Web Audio like media, ignoring the switch.
 * - Older iOS: a playing <audio> element switches the page to the playback
 *   category, so a silent looping clip runs while the engine plays.
 *
 * Call preferPlayback() synchronously inside the user's gesture (iOS only
 * lets audio start from one), and releasePlayback() when playback stops so
 * the lock screen doesn't keep showing a player.
 */
import { isIOS } from './device';

let silent = null;

function silentClip() {
  // 0.5 s of 8-bit mono silence at 8 kHz (unsigned PCM: 0x80 is zero).
  const rate = 8000;
  const n = rate / 2;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  str(36, 'data');
  v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(0x80);
  const el = new Audio(URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })));
  el.loop = true;
  el.preload = 'auto';
  el.setAttribute('x-webkit-airplay', 'deny');
  return el;
}

export function preferPlayback() {
  try {
    if (navigator.audioSession) {
      if (navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback';
      return;
    }
  } catch (e) {
    // read-only in some builds; fall through to the <audio> fallback
  }
  if (!isIOS()) return;
  if (!silent) silent = silentClip();
  silent.play().catch(() => {});
}

export function releasePlayback() {
  if (silent && !silent.paused) silent.pause();
}

/**
 * Start (or restart) an AudioContext from a user gesture. iOS leaves a
 * context 'interrupted' after a call, Siri or the screen locking, and only
 * resume() inside a gesture brings it back. Call synchronously from the
 * click/keydown handler; the returned promise settles when it runs.
 */
export function resumeContext(ctx) {
  if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return Promise.resolve();
  return ctx.resume().catch(() => {});
}

/**
 * Calls onStop() when the context stops running on its own while playing
 * (iOS 'interrupted' after a call/Siri/lock, or the system suspending a
 * backgrounded tab), so the transport shows Paused instead of a frozen
 * playhead under a Pause button. Returns an unsubscribe function.
 */
export function watchInterruptions(ctx, isPlaying, onStop) {
  if (!ctx) return () => {};
  const onState = () => {
    if (ctx.state !== 'running' && ctx.state !== 'closed' && isPlaying()) onStop();
  };
  ctx.addEventListener('statechange', onState);
  return () => ctx.removeEventListener('statechange', onState);
}
