/**
 * Image sizes and orientation read from file headers, so opening a file
 * costs no decoder and a huge image is known to be huge before anything
 * decodes it. Every reader works on a prefix of the file and answers null
 * for anything it does not recognise (headers are untrusted input).
 */

import type { Format } from "./kinds.ts";

export interface Size {
  width: number;
  height: number;
}

/** How many leading bytes `readSize` needs for any format here (JPEG's markers can sit behind a large EXIF block). */
export const HEADER_BYTES = 256 * 1024;

const MAX_SIDE = 1_000_000;

const valid = (width: number, height: number): Size | null =>
  Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE ? { width, height } : null;

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function pngSize(bytes: Uint8Array): Size | null {
  // 8 bytes of signature, then IHDR: length, "IHDR", width, height.
  if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR") return null;
  const dv = view(bytes);
  return valid(dv.getUint32(16), dv.getUint32(20));
}

function gifSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 10) return null;
  const dv = view(bytes);
  return valid(dv.getUint16(6, true), dv.getUint16(8, true));
}

function bmpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 26) return null;
  const dv = view(bytes);
  const header = dv.getUint32(14, true);
  if (header === 12) return valid(dv.getUint16(18, true), dv.getUint16(20, true));
  // A positive height is a bottom-up bitmap, a negative one top-down.
  return valid(dv.getInt32(18, true), Math.abs(dv.getInt32(22, true)));
}

function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 25) return null;
  const dv = view(bytes);
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    if (bytes.length < 30) return null;
    const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
    const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
    return valid(width, height);
  }
  if (chunk === "VP8 ") {
    if (bytes.length < 30 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return valid(dv.getUint16(26, true) & 0x3fff, dv.getUint16(28, true) & 0x3fff);
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    const bits = dv.getUint32(21, true);
    return valid((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  return null;
}

/** Walk a JPEG's markers to its first frame header. */
function jpegSize(bytes: Uint8Array): Size | null {
  const dv = view(bytes);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = dv.getUint16(at + 2);
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return at + 9 <= bytes.length ? valid(dv.getUint16(at + 7), dv.getUint16(at + 5)) : null;
    if (marker === 0xda) return null;
    at += 2 + length;
  }
  return null;
}

/** A JPEG's EXIF orientation, 1 to 8 (1 is upright); 1 when there is none. */
export function jpegOrientation(bytes: Uint8Array): number {
  const dv = view(bytes);
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return 1;
    const marker = bytes[at + 1] as number;
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const length = dv.getUint16(at + 2);
    if (length < 2 || marker === 0xda) return 1;
    if (marker === 0xe1 && at + 4 + 6 <= bytes.length && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === "Exif") {
      return exifOrientation(bytes.subarray(at + 10, Math.min(bytes.length, at + 2 + length)));
    }
    at += 2 + length;
  }
  return 1;
}

/** The orientation tag of a TIFF block (EXIF without its "Exif\0\0" lead), 1 when absent or odd. */
export function exifOrientation(tiff: Uint8Array): number {
  if (tiff.length < 14) return 1;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
  const dv = view(tiff);
  if (dv.getUint16(2, little) !== 42) return 1;
  const ifd = dv.getUint32(4, little);
  if (ifd < 8 || ifd + 2 > tiff.length) return 1;
  const entries = Math.min(dv.getUint16(ifd, little), 256);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > tiff.length) return 1;
    if (dv.getUint16(entry, little) === 0x0112) {
      const value = dv.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}

/** An SVG's size from its root element's `width`/`height`, else its `viewBox`; 512 square when it names neither. */
export function svgSize(text: string): Size {
  const root = /<svg\b[^>]*>/i.exec(text)?.[0] ?? "";
  const attr = (name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root)?.[1];
  const length = (value: string | undefined): number | null => {
    const match = /^\s*([0-9]*\.?[0-9]+)\s*(px|pt|pc|mm|cm|in)?\s*$/i.exec(value ?? "");
    if (!match) return null;
    const unit = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[(match[2] ?? "px").toLowerCase()] ?? 1;
    return Number(match[1]) * unit;
  };
  const box = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const boxSize = box && box.length === 4 && box.every(Number.isFinite) ? { width: box[2] as number, height: box[3] as number } : null;
  let width = length(attr("width"));
  let height = length(attr("height"));
  if (width === null && height === null && boxSize) [width, height] = [boxSize.width, boxSize.height];
  else if (boxSize && boxSize.width > 0 && boxSize.height > 0) {
    // One side given: the other follows the viewBox's proportions.
    if (width === null && height !== null) width = (height * boxSize.width) / boxSize.height;
    if (height === null && width !== null) height = (width * boxSize.height) / boxSize.width;
  }
  const fit = (value: number | null): number => (value !== null && Number.isFinite(value) && value >= 1 ? Math.min(Math.round(value), MAX_SIDE) : 512);
  return { width: fit(width), height: fit(height) };
}

/** The pixel size of an image file's header, as stored (before any EXIF turn), or null. */
export function readSize(format: Format, head: Uint8Array): Size | null {
  switch (format) {
    case "png":
      return pngSize(head);
    case "gif":
      return gifSize(head);
    case "bmp":
      return bmpSize(head);
    case "webp":
      return webpSize(head);
    case "jpeg":
      return jpegSize(head);
    case "svg":
      return svgSize(new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, 8192)));
    default:
      return null;
  }
}

/** Whether an EXIF orientation turns the picture a quarter (5 to 8), swapping its sides. */
export const swapsSides = (orientation: number): boolean => orientation >= 5 && orientation <= 8;
