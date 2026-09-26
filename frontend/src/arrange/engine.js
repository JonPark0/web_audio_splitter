/**
 * Arrangement audio engine (raw Web Audio API, no dependencies).
 *
 * Contract for the Arrange UI — the UI never touches Web Audio directly:
 *
 *   const engine = createEngine();
 *   engine.setProject(project);   // call on EVERY project change (cheap,
 *                                 // idempotent): applies mix changes live,
 *                                 // reschedules if timing changed while
 *                                 // playing, prefetches audio/renders
 *   await engine.play(fromBeat);  // first call must come from a user
 *                                 // gesture (browser autoplay policy)
 *   engine.stop();                // pause; playhead stays where it stopped
 *   engine.seek(beat);            // move playhead (keeps playing if playing)
 *   engine.isPlaying();
 *   engine.getPositionBeats();    // poll from requestAnimationFrame
 *   engine.setMetronome(on);
 *   await engine.getBuffer(sampleId);  // decoded SOURCE audio (AudioBuffer)
 *                                      // for drawing clip waveforms
 *   const off = engine.on('state', ({ playing, positionBeats, loading }) => {});
 *   engine.on('error', ({ message }) => {});
 *   engine.dispose();
 *
 * Behaviour:
 *   - Looping follows project.loop (enabled/start_beat/end_beat).
 *   - Without a loop, playback stops by itself after the last clip ends.
 *   - `loading` in the state event = number of audio fetches in flight.
 *   - Timing math comes from project.js (clipRate, clipDurationBeats, …).
 *
 * @typedef {import('./project').Project} Project
 */

export function createEngine() {
  const notImplemented = (name) => () => {
    throw new Error(`engine.${name} not implemented yet`);
  };
  return {
    setProject: notImplemented('setProject'),
    play: notImplemented('play'),
    stop: notImplemented('stop'),
    seek: notImplemented('seek'),
    isPlaying: () => false,
    getPositionBeats: () => 0,
    setMetronome: notImplemented('setMetronome'),
    getBuffer: notImplemented('getBuffer'),
    on: () => () => {},
    dispose: () => {},
  };
}
