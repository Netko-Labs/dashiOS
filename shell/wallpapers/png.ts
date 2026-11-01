/**
 * A minimal PNG writer for generate.ts: 8-bit RGB, one IDAT, the filter for
 * each scanline picked by the usual smallest-sum-of-magnitudes rule. Smooth
 * gradients are mostly runs of equal or near-equal bytes, which the Sub, Up,
 * and Paeth filters turn into runs of zeros for deflate.
 */

import { deflateSync } from "node:zlib";

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const paeth = (a: number, b: number, c: number): number => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** `rgb` is width*height*3 bytes, top row first. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const stride = width * 3;
  const raw = new Uint8Array((stride + 1) * height);
  const candidates = [0, 1, 2, 4].map(() => new Uint8Array(stride));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = rgb.subarray(y * stride, (y + 1) * stride);
    const above = y > 0 ? rgb.subarray((y - 1) * stride, y * stride) : zero;
    const [none, sub, up, paethRow] = candidates as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    for (let i = 0; i < stride; i++) {
      const left = i >= 3 ? (row[i - 3] as number) : 0;
      const upLeft = i >= 3 ? (above[i - 3] as number) : 0;
      const here = row[i] as number;
      none[i] = here;
      sub[i] = (here - left) & 0xff;
      up[i] = (here - (above[i] as number)) & 0xff;
      paethRow[i] = (here - paeth(left, above[i] as number, upLeft)) & 0xff;
    }
    let best = 0;
    let bestSum = Number.POSITIVE_INFINITY;
    candidates.forEach((candidate, index) => {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const byte = candidate[i] as number;
        sum += byte < 128 ? byte : 256 - byte;
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = index;
      }
    });
    raw[y * (stride + 1)] = [0, 1, 2, 4][best] as number;
    raw.set(candidates[best] as Uint8Array, y * (stride + 1) + 1);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, deflate, adaptive filters, no interlace
  const parts = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
