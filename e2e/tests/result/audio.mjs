/**
 * Small readers for checking what the result screen saved, in Node so CI
 * needs nothing extra: WAV (PCM 16/24/32-bit, float 32, incl. the
 * WAVE_FORMAT_EXTENSIBLE header libsndfile writes) and zip entry names.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

/** { format: 'pcm'|'float', bits, channels, sampleRate, frames, dataOffset, channelData: Float32Array[] } */
export function readWav(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  for (let p = 12; p + 8 <= b.length; ) {
    const id = b.toString('ascii', p, p + 4);
    let size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(p + 8);
      if (tag === 0xfffe) tag = b.readUInt16LE(p + 8 + 24); // extensible: sub-format GUID starts with the tag
      fmt = { tag, channels: b.readUInt16LE(p + 10), sampleRate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    } else if (id === 'data') {
      dataOffset = p + 8;
      // streamed writers may leave 0/0xffffffff here
      if (!size || size === 0xffffffff || dataOffset + size > b.length) size = b.length - dataOffset;
      dataSize = size;
      break;
    }
    p += 8 + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error('WAV without fmt/data');
  const bytes = fmt.bits / 8;
  const frames = Math.floor(dataSize / (bytes * fmt.channels));
  const channelData = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const float = fmt.tag === 3;
  for (let i = 0; i < frames; i += 1) {
    for (let c = 0; c < fmt.channels; c += 1) {
      const o = dataOffset + (i * fmt.channels + c) * bytes;
      let v;
      if (float && bytes === 4) v = b.readFloatLE(o);
      else if (float && bytes === 8) v = b.readDoubleLE(o);
      else if (bytes === 2) v = b.readInt16LE(o) / 32768;
      else if (bytes === 3) v = b.readIntLE(o, 3) / 8388608;
      else if (bytes === 4) v = b.readInt32LE(o) / 2147483648;
      else throw new Error(`unsupported ${fmt.bits}-bit WAV`);
      channelData[c][i] = v;
    }
  }
  return { format: float ? 'float' : 'pcm', bits: fmt.bits, channels: fmt.channels, sampleRate: fmt.sampleRate, frames, dataOffset, channelData };
}

export const peak = (w) => Math.max(...w.channelData.map((ch) => ch.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));

/** Largest |a - b| over frames [from, to) of every channel. */
export function maxDiff(a, b, from, to, offsetB = 0) {
  let m = 0;
  for (let c = 0; c < Math.min(a.channels, b.channels); c += 1) {
    for (let i = from; i < to; i += 1) m = Math.max(m, Math.abs(a.channelData[c][i] - b.channelData[c][i + offsetB]));
  }
  return m;
}

/** Copy every 16-bit WAV in `dir` into dir/recovered/, scaled by `gain` (hand-made "recovered" stems). */
export function makeRecovered(dir, names, gain = 0.5) {
  const out = path.join(dir, 'recovered');
  mkdirSync(out, { recursive: true });
  for (const name of names) {
    const src = readFileSync(path.join(dir, name));
    const w = readWav(src);
    if (w.bits !== 16 || w.format !== 'pcm') throw new Error(`${name}: expected 16-bit PCM`);
    const copy = Buffer.from(src);
    for (let o = w.dataOffset; o + 2 <= w.dataOffset + w.frames * w.channels * 2; o += 2) copy.writeInt16LE(Math.round(copy.readInt16LE(o) * gain), o);
    writeFileSync(path.join(out, name), copy);
  }
}

/** File names in a zip (from its central directory). */
export function zipNames(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i -= 1) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const names = [];
  for (let k = 0; k < count; k += 1) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const n = b.readUInt16LE(p + 28);
    const extra = b.readUInt16LE(p + 30);
    const comment = b.readUInt16LE(p + 32);
    names.push(b.toString('utf8', p + 46, p + 46 + n));
    p += 46 + n + extra + comment;
  }
  return names;
}
