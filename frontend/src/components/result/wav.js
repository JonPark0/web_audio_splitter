/**
 * WAV over HTTP Range: read the header once, then fetch any frame span and
 * turn it into per-channel Float32 at the audio context's rate. Stems are
 * plain PCM WAVs (16/24/32-bit int or 32-bit float), so no decoder is needed
 * and nothing but the requested bytes is downloaded.
 */

const HEADER_PROBE = 8192;

function fourcc(dv, off) {
  return String.fromCharCode(dv.getUint8(off), dv.getUint8(off + 1), dv.getUint8(off + 2), dv.getUint8(off + 3));
}

async function fetchRange(url, start, end, signal) {
  const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res;
}

/** { format, channels, rate, bits, bytesPerFrame, dataStart, frames } */
export async function fetchWavHeader(url, signal) {
  let probe = HEADER_PROBE;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetchRange(url, 0, probe - 1, signal);
    const total = Number((res.headers.get('content-range') || '').split('/')[1]) || null;
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf);
    if (buf.byteLength < 12 || fourcc(dv, 0) !== 'RIFF' || fourcc(dv, 8) !== 'WAVE') throw new Error('Not a WAV file');
    let off = 12;
    let fmt = null;
    while (off + 8 <= buf.byteLength) {
      const id = fourcc(dv, off);
      const size = dv.getUint32(off + 4, true);
      if (id === 'fmt ' && off + 24 <= buf.byteLength) {
        let format = dv.getUint16(off + 8, true);
        // WAVE_FORMAT_EXTENSIBLE: the real format is the sub-format GUID's first word.
        if (format === 0xfffe && off + 34 <= buf.byteLength) format = dv.getUint16(off + 32, true);
        fmt = {
          format,
          channels: dv.getUint16(off + 10, true),
          rate: dv.getUint32(off + 12, true),
          bits: dv.getUint16(off + 22, true),
        };
      } else if (id === 'data') {
        if (!fmt) throw new Error('WAV has no fmt chunk');
        if (!(fmt.format === 1 || fmt.format === 3)) throw new Error(`Unsupported WAV format ${fmt.format}`);
        const bytesPerFrame = (fmt.bits / 8) * fmt.channels;
        const dataStart = off + 8;
        const available = total ? total - dataStart : size;
        // 0xFFFFFFFF / 0 = streamed writers that never patched the size.
        const dataBytes = size && size !== 0xffffffff ? Math.min(size, available) : available;
        return { ...fmt, bytesPerFrame, dataStart, frames: Math.floor(dataBytes / bytesPerFrame) };
      }
      off += 8 + size + (size % 2);
    }
    probe = Math.max(off + 64, 131072); // long LIST chunk before data: read further
  }
  throw new Error('WAV data chunk not found');
}

/** Interleaved PCM bytes → one Float32Array per channel. */
function deinterleave(buf, header, frames) {
  const { channels, bits, format } = header;
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  if (format === 3 && bits === 32) {
    const src = new Float32Array(buf, 0, frames * channels);
    for (let c = 0; c < channels; c += 1) {
      const dst = out[c];
      for (let i = 0, j = c; i < frames; i += 1, j += channels) dst[i] = src[j];
    }
  } else if (bits === 16) {
    const src = new Int16Array(buf, 0, frames * channels);
    for (let c = 0; c < channels; c += 1) {
      const dst = out[c];
      for (let i = 0, j = c; i < frames; i += 1, j += channels) dst[i] = src[j] / 32768;
    }
  } else if (bits === 32) {
    const src = new Int32Array(buf, 0, frames * channels);
    for (let c = 0; c < channels; c += 1) {
      const dst = out[c];
      for (let i = 0, j = c; i < frames; i += 1, j += channels) dst[i] = src[j] / 2147483648;
    }
  } else if (bits === 24) {
    const u8 = new Uint8Array(buf);
    for (let c = 0; c < channels; c += 1) {
      const dst = out[c];
      for (let i = 0; i < frames; i += 1) {
        const p = (i * channels + c) * 3;
        let v = u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16);
        if (v & 0x800000) v |= ~0xffffff;
        dst[i] = v / 8388608;
      }
    }
  } else if (bits === 64 && format === 3) {
    const src = new Float64Array(buf, 0, frames * channels);
    for (let c = 0; c < channels; c += 1) {
      const dst = out[c];
      for (let i = 0, j = c; i < frames; i += 1, j += channels) dst[i] = src[j];
    }
  } else {
    throw new Error(`Unsupported WAV sample size ${bits}`);
  }
  return out;
}

/** Source frames [f0, f1) (clamped to the file) → { channels: Float32Array[], first }. */
export async function fetchFrames(url, header, f0, f1, signal) {
  const a = Math.max(0, f0);
  const b = Math.min(header.frames, f1);
  if (b <= a) return { channels: Array.from({ length: header.channels }, () => new Float32Array(0)), first: a };
  const start = header.dataStart + a * header.bytesPerFrame;
  const end = header.dataStart + b * header.bytesPerFrame - 1;
  const res = await fetchRange(url, start, end, signal);
  const buf = await res.arrayBuffer();
  const frames = Math.min(b - a, Math.floor(buf.byteLength / header.bytesPerFrame));
  return { channels: deinterleave(buf, header, frames), first: a };
}

// ---- Resampling ------------------------------------------------------------
// Chrome's AudioBufferSourceNode resamples with linear interpolation, which
// dulls and aliases the top octave — exactly the content a recovered stem is
// being compared on. So stems whose rate differs from the context are
// resampled here with a windowed-sinc polyphase filter, evaluated per output
// frame on the context's global frame grid: a chunk boundary is invisible
// (same result as resampling the whole file in one go).

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function bessel0(x) {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 32; k += 1) {
    term *= (x / (2 * k)) ** 2;
    sum += term;
    if (term < 1e-12 * sum) break;
  }
  return sum;
}

export function createResampler(srcRate, dstRate) {
  const g = gcd(srcRate, dstRate);
  const L = dstRate / g; // output frames per cycle
  const M = srcRate / g; // source frames per cycle
  const ratio = Math.min(1, dstRate / srcRate);
  const half = Math.ceil(16 / ratio); // taps each side, in source samples
  const taps = half * 2;
  const fc = 0.5 * ratio * 0.97; // cutoff, cycles per source sample
  const beta = 8.6;
  const i0b = bessel0(beta);
  const kernel = (u) => {
    // u in source samples from the tap to the output instant
    const r = u / half;
    if (r <= -1 || r >= 1) return 0;
    const w = bessel0(beta * Math.sqrt(1 - r * r)) / i0b;
    const x = 2 * fc * u;
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return 2 * fc * sinc * w;
  };
  // Phase p (fraction p/L): taps for source samples base-half+1 .. base+half.
  const phases = L <= 4096 ? L : 0;
  let table = null;
  if (phases) {
    table = new Float32Array(phases * taps);
    for (let p = 0; p < phases; p += 1) {
      const frac = p / L;
      let sum = 0;
      for (let t = 0; t < taps; t += 1) {
        const v = kernel(t - half + 1 - frac);
        table[p * taps + t] = v;
        sum += v;
      }
      for (let t = 0; t < taps; t += 1) table[p * taps + t] /= sum; // unity DC gain
    }
  }

  return {
    /** Source frames needed to produce output frames [j0, j0 + n). */
    sourceSpan(j0, n) {
      const first = Math.floor((j0 * M) / L) - half + 1;
      const last = Math.floor(((j0 + n - 1) * M) / L) + half;
      return [first, last + 1];
    },
    /** src: Float32Array of source frames starting at `srcFirst`. */
    run(src, srcFirst, j0, n) {
      const out = new Float32Array(n);
      const len = src.length;
      for (let i = 0; i < n; i += 1) {
        const j = j0 + i;
        const num = j * M;
        const base = Math.floor(num / L);
        const p = num - base * L;
        const s0 = base - half + 1 - srcFirst;
        let acc = 0;
        if (table) {
          const row = p * taps;
          if (s0 >= 0 && s0 + taps <= len) {
            for (let t = 0; t < taps; t += 1) acc += src[s0 + t] * table[row + t];
          } else {
            for (let t = 0; t < taps; t += 1) {
              const s = s0 + t;
              if (s >= 0 && s < len) acc += src[s] * table[row + t];
            }
          }
        } else {
          const frac = p / L;
          for (let t = 0; t < taps; t += 1) {
            const s = s0 + t;
            if (s >= 0 && s < len) acc += src[s] * kernel(t - half + 1 - frac);
          }
        }
        out[i] = acc;
      }
      return out;
    },
  };
}
