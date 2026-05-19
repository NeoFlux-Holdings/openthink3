// Store-only PKZip writer + CRC32 helper. Originally inline in
// Library.tsx (bulk artifact export); extracted here so the Settings
// "export everything" snapshot can share the same implementation
// without dragging a third-party zip lib into the bundle.
//
// Format choices:
//   * Store only (no compression). The Library export bundles PNGs +
//     PDFs that don't compress further; the Settings snapshot is
//     JSON that COULD compress but the bytes are small enough that
//     the ~50 LOC + browser-compat cost of a DEFLATE pipeline isn't
//     worth it.
//   * Filenames are encoded UTF-8 with no central-directory flag —
//     fine for the ASCII-only names we generate, and most modern
//     unzippers handle UTF-8 anyway.

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function buildZipBlob(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);
    const size = e.data.byteLength;
    // Local file header (30 bytes + name)
    const local = new ArrayBuffer(30 + nameBytes.length);
    const lv = new DataView(local);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, 0, true); // method = store
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0x21, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    new Uint8Array(local, 30).set(nameBytes);
    localParts.push(new Uint8Array(local), e.data);

    // Central directory entry
    const central = new ArrayBuffer(46 + nameBytes.length);
    const cv = new DataView(central);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    new Uint8Array(central, 46).set(nameBytes);
    centralParts.push(new Uint8Array(central));
    offset += 30 + nameBytes.length + size;
  }
  const cdSize = centralParts.reduce((acc, p) => acc + p.byteLength, 0);
  const cdOffset = offset;
  const eocd = new ArrayBuffer(22);
  const ev = new DataView(eocd);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);
  const parts: BlobPart[] = [
    ...localParts,
    ...centralParts,
    new Uint8Array(eocd),
  ] as BlobPart[];
  return new Blob(parts, { type: 'application/zip' });
}

// Minimal store-only zip reader. Pairs with `buildZipBlob` above —
// we only need to read archives WE wrote, so we don't bother
// supporting compressed entries or ZIP64. Walks the End-Of-Central-
// Directory record back from the file tail to find each entry, then
// seeks to its local file header to grab the (uncompressed) bytes.
//
// Returns `[]` when the input doesn't look like a zip OR contains
// any compressed entries (graceful degrade — caller should toast a
// "not a snapshot" hint rather than crash).
export async function readZipBlob(blob: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // Find EOCD signature scanning back from the tail. Max comment
  // length is 65535 + 22 byte EOCD; we cap at 70k for safety.
  const minStart = Math.max(0, buf.length - 70_000);
  let eocdAt = -1;
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) return [];
  const entryCount = view.getUint16(eocdAt + 10, true);
  const cdOffset = view.getUint32(eocdAt + 16, true);
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) return [];
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const uncompressedSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const nameBytes = buf.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder().decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;
    // Only store-only (method 0) is supported. A compressed entry
    // would need a DEFLATE pipeline we don't ship.
    if (method !== 0) return [];
    if (compressedSize !== uncompressedSize) return [];
    // Walk into the local file header to find the data start. LFH
    // is 30 bytes + name length + extra length, then the data.
    const lfhAt = localHeaderOffset;
    if (view.getUint32(lfhAt, true) !== 0x04034b50) return [];
    const lfhNameLen = view.getUint16(lfhAt + 26, true);
    const lfhExtraLen = view.getUint16(lfhAt + 28, true);
    const dataAt = lfhAt + 30 + lfhNameLen + lfhExtraLen;
    const data = buf.slice(dataAt, dataAt + uncompressedSize);
    entries.push({ name, data });
  }
  return entries;
}

let crc32Table: Uint32Array | null = null;
export function crc32(buf: Uint8Array): number {
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crc32Table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc32Table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
