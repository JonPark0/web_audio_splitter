// Shared between the sample browser (drag source) and the timeline (drop target).

/** dataTransfer type for a sample dragged onto the timeline (payload: JSON). */
export const SAMPLE_MIME = 'application/x-arrange-sample';

/**
 * The sample being dragged right now. dataTransfer can't be read during
 * dragover (only on drop), so the timeline reads this to size its ghost.
 */
export const sampleDrag = { current: null };
