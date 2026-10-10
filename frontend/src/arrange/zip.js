/**
 * Minimal ZIP writer (STORE, no compression — WAV barely compresses and
 * this keeps it dependency-free). Enough for bundling stem exports.
 *
 *   const blob = zipFiles([{ name: 'a.wav', data: arrayBuffer }, …]);
 *   // or, to let each file's bytes go as soon as it's made (stem export):
 *   const blob = zipFiles([zipEntry('a.wav', arrayBuffer), …]);
 */

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}

export function crc32(bytes) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date/time for "now" (ZIP's native timestamp format). */
function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * One file, checksummed now and held as a Blob, so the caller can drop the
 * bytes (the browser may keep a Blob out of the page's memory).
 * @returns {{name: string, crc: number, size: number, blob: Blob}}
 */
export function zipEntry(name, data) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return { name, crc: crc32(bytes), size: bytes.length, blob: new Blob([bytes]) };
}

/**
 * @param {({name: string, data: ArrayBuffer|Uint8Array} | ReturnType<typeof zipEntry>)[]} files
 * @returns {Blob} application/zip
 */
export function zipFiles(files) {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const { crc, size, blob } = f.blob ? f : zipEntry(f.name, f.data);
    const name = enc.encode(f.name);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // STORE
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(local.buffer, name, blob);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true); // version made by
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, time, true);
    cen.setUint16(14, date, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, size, true);
    cen.setUint32(24, size, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    central.push(cen.buffer, name);

    offset += 30 + name.length + size;
  }

  const centralSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
