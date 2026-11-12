/**
 * A tray item's pixmap as a PNG file the bar can draw. StatusNotifierItem
 * sends pictures as `a(iiay)`: a list of sizes, each ARGB32 in network byte
 * order (A, R, G, B per pixel, not premultiplied). The one nearest the bar's
 * size is turned into RGBA and encoded here: one IDAT, filter type 0 on every
 * row, zlib from `node:zlib`.
 */

import { deflateSync } from "node:zlib";

export interface Pixmap {
  width: number;
  height: number;
  /** ARGB32, network byte order, `width * height * 4` bytes. */
  data: Uint8Array;
}

/** Bigger than any tray icon; a pixmap past this is refused rather than encoded. */
export const MAX_PIXMAP_SIDE = 512;

/** The size the bar asks for when it does not say. */
export const PREFERRED_SIDE = 32;

const isSide = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_PIXMAP_SIDE;

/** An `a(iiay)` value as the pixmaps in it that are whole; malformed entries are skipped. */
export function parsePixmaps(value: unknown): Pixmap[] {
  if (!Array.isArray(value)) return [];
  const pixmaps: Pixmap[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry)) continue;
    const [width, height, data] = entry;
    if (!isSide(width) || !isSide(height) || !(data instanceof Uint8Array)) continue;
    if (data.length !== width * height * 4) continue;
    pixmaps.push({ width, height, data });
  }
  return pixmaps;
}

/** The pixmap whose larger side is nearest `side`; the bigger of two equally near. */
export function pickPixmap(pixmaps: readonly Pixmap[], side = PREFERRED_SIDE): Pixmap | null {
  let best: Pixmap | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const pixmap of pixmaps) {
    const size = Math.max(pixmap.width, pixmap.height);
    const distance = Math.abs(size - side);
    if (distance < bestDistance || (distance === bestDistance && best && size > Math.max(best.width, best.height))) {
      best = pixmap;
      bestDistance = distance;
    }
  }
  return best;
}

/** ARGB32 (network byte order) to RGBA, byte for byte. */
export function argbToRgba(argb: Uint8Array): Uint8Array {
  const rgba = new Uint8Array(argb.length);
  for (let i = 0; i + 3 < argb.length; i += 4) {
    rgba[i] = argb[i + 1] as number;
    rgba[i + 1] = argb[i + 2] as number;
    rgba[i + 2] = argb[i + 3] as number;
    rgba[i + 3] = argb[i] as number;
  }
  return rgba;
}

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const encoder = new TextEncoder();

/** One chunk: length, type, data, and the CRC of type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(encoder.encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An 8-bit RGBA image as PNG bytes. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("a PNG needs a positive size");
  if (rgba.length !== width * height * 4) throw new RangeError("RGBA data does not match the size");
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  // Bit depth 8, color type 6 (RGBA), deflate, adaptive filtering, no interlace.
  header.set([8, 6, 0, 0, 0], 8);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    // Each row starts with its filter type, 0 (none).
    raw.set(rgba.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const parts = [SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}
