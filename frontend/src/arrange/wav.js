/**
 * WAV (RIFF, integer PCM) encoding for mixdown export. No DOM needed except
 * the final Blob, so the byte layout can be checked from Node.
 *
 * Accepts an AudioBuffer or anything shaped like one:
 *   { numberOfChannels, sampleRate, length, getChannelData(ch) -> Float32Array }
 */

const HEADER_BYTES = 44;

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Float sample -> clamped [-1, 1]; NaN becomes silence, ±Infinity clips. */
function clampSample(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

/**
 * Encode to a WAV file as an ArrayBuffer.
 * @param {AudioBuffer} audioBuffer
 * @param {{bitDepth?: 16|24}} [options]
 * @returns {ArrayBuffer}
 */
export function encodeWavBytes(audioBuffer, { bitDepth = 24 } = {}) {
  if (bitDepth !== 16 && bitDepth !== 24) throw new Error(`Unsupported bit depth: ${bitDepth}`);
  const channels = audioBuffer.numberOfChannels;
  const { sampleRate, length } = audioBuffer;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = length * blockAlign;
  const pad = dataSize % 2; // RIFF chunks are word-aligned
  const buffer = new ArrayBuffer(HEADER_BYTES + dataSize + pad);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize + pad, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const data = [];
  for (let ch = 0; ch < channels; ch++) data.push(audioBuffer.getChannelData(ch));

  if (bitDepth === 16) {
    let pos = HEADER_BYTES;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const s = clampSample(data[ch][i]);
        view.setInt16(pos, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
        pos += 2;
      }
    }
  } else {
    // 24-bit little-endian, written byte by byte (DataView has no Int24).
    const bytes = new Uint8Array(buffer);
    let pos = HEADER_BYTES;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < channels; ch++) {
        const s = clampSample(data[ch][i]);
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); // -8388608 .. 8388607
        bytes[pos] = v & 0xff;
        bytes[pos + 1] = (v >> 8) & 0xff;
        bytes[pos + 2] = (v >> 16) & 0xff;
        pos += 3;
      }
    }
  }
  return buffer;
}

/**
 * Encode an AudioBuffer as a WAV Blob (default 24-bit PCM).
 * @returns {Blob}
 */
export function encodeWav(audioBuffer, options) {
  return new Blob([encodeWavBytes(audioBuffer, options)], { type: 'audio/wav' });
}
