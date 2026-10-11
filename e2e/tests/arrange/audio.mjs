/**
 * Readers for what the Arrange export downloads, in Node (nothing extra on
 * CI): a WAV header + peak/RMS reader (PCM 16/24/32, float 32) and a reader
 * for the STORE-only ZIP the app writes (src/arrange/zip.js).
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

/** { tag, channels, sampleRate, bits, frames, seconds, peak, rms } */
export function wavInfo(input) {
  const b = Buffer.isBuffer(input) ? input : readFileSync(input);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a RIFF/WAVE file');
  let fmt = null;
  let off = -1;
  let size = 0;
  for (let p = 12; p + 8 <= b.length; ) {
    const id = b.toString('ascii', p, p + 4);
    const sz = b.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(p + 8);
      if (tag === 0xfffe) tag = b.readUInt16LE(p + 32);
      fmt = { tag, channels: b.readUInt16LE(p + 10), sampleRate: b.readUInt32LE(p + 12), align: b.readUInt16LE(p + 20), bits: b.readUInt16LE(p + 22) };
    } else if (id === 'data') {
      off = p + 8;
      size = Math.min(sz, b.length - off);
      break;
    }
    p += 8 + sz + (sz % 2);
  }
  if (!fmt || off < 0) throw new Error('WAV without fmt/data chunk');
  const bytes = fmt.bits / 8;
  const n = Math.floor(size / bytes);
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const o = off + i * bytes;
    let v;
    if (fmt.tag === 3) v = b.readFloatLE(o);
    else if (bytes === 2) v = b.readInt16LE(o) / 32768;
    else if (bytes === 3) v = b.readIntLE(o, 3) / 8388608;
    else v = b.readInt32LE(o) / 2147483648;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
  }
  const frames = Math.floor(size / fmt.align);
  return { tag: fmt.tag, channels: fmt.channels, sampleRate: fmt.sampleRate, bits: fmt.bits, frames, seconds: frames / fmt.sampleRate, peak, rms: Math.sqrt(sum / Math.max(1, n)) };
}

/** Entries of a ZIP file: [{ name, data: Buffer }] (local headers; STORE or DEFLATE). */
export function zipEntries(input) {
  const b = Buffer.isBuffer(input) ? input : readFileSync(input);
  const out = [];
  let p = 0;
  while (p + 30 <= b.length && b.readUInt32LE(p) === 0x04034b50) {
    const method = b.readUInt16LE(p + 8);
    const csize = b.readUInt32LE(p + 18);
    const nameLen = b.readUInt16LE(p + 26);
    const extraLen = b.readUInt16LE(p + 28);
    const name = b.toString('utf8', p + 30, p + 30 + nameLen);
    const start = p + 30 + nameLen + extraLen;
    const raw = b.subarray(start, start + csize);
    out.push({ name, data: method === 0 ? Buffer.from(raw) : inflateRawSync(raw) });
    p = start + csize;
  }
  if (!out.length) throw new Error('not a ZIP file (or no entries)');
  return out;
}
