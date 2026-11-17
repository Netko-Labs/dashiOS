/**
 * The Custom… picker's pictures, made on the CPU as small PNGs (the accent's
 * design: cached Images, not gradients, which Metal does not draw): the hue
 * strip, the saturation and brightness field for one hue (drawn again only
 * when the hue changes, one file per 2°), and the Custom… swatch's rainbow
 * ring. They are written once into `$XDG_CACHE_HOME/dashi/accent/` and
 * reused from there.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** The field's and the strip's measures, in points; the PNGs are drawn at twice that. */
export const FIELD = { width: 264, height: 150 } as const;
export const STRIP = { width: 264, height: 12 } as const;
export const RING = 44;
const SCALE = 2;

/** HSV (h in degrees, s and v 0..1) as 0..255 channels. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

export function rgbToHsv(hex: string): { h: number; s: number; v: number } {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

export const hexOf = ([r, g, b]: readonly number[]): string => `#${[r, g, b].map((c) => (c ?? 0).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGBA picture as a PNG file's bytes. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => readonly number[]): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4);
    for (let x = 0; x < width; x++) raw.set(pixel(x, y).slice(0, 4), row + 1 + x * 4);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function cacheDir(env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CACHE_HOME?.startsWith("/") ? env.XDG_CACHE_HOME : join(env.HOME || homedir(), ".cache");
  return join(base, "dashi", "accent");
}

/** The file for `name`, drawn by `draw` the first time it is asked for; null when it cannot be written. */
function cached(name: string, draw: () => Uint8Array): string | null {
  const dir = cacheDir();
  const path = join(dir, name);
  try {
    if (!existsSync(path)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, draw());
    }
    return path;
  } catch (error) {
    console.error(`dashi-shell: the accent picker could not draw ${name}:`, error);
    return null;
  }
}

/** The hue strip: red round to red, left to right. */
export const hueStrip = (): string | null =>
  cached("hue.png", () => encodePng(STRIP.width * SCALE, STRIP.height * SCALE, (x) => [...hsvToRgb((x / (STRIP.width * SCALE - 1)) * 360, 1, 1), 255]));

/** The field for `hue` (to the nearest 2°): saturation across, brightness up. */
export function hueField(hue: number): string | null {
  const h = (Math.round(hue / 2) * 2) % 360;
  const width = FIELD.width * SCALE;
  const height = FIELD.height * SCALE;
  return cached(`field-${h}.png`, () => encodePng(width, height, (x, y) => [...hsvToRgb(h, x / (width - 1), 1 - y / (height - 1)), 255]));
}

/** The Custom… swatch: a rainbow ring, clear in the middle. */
export const rainbowRing = (): string | null =>
  cached("ring.png", () => {
    const size = RING * SCALE;
    const c = (size - 1) / 2;
    return encodePng(size, size, (x, y) => {
      const r = Math.hypot(x - c, y - c);
      const inside = r <= c && r >= c * 0.62;
      const h = ((Math.atan2(y - c, x - c) * 180) / Math.PI + 450) % 360;
      return [...hsvToRgb(h, 0.85, 0.95), inside ? 255 : 0];
    });
  });
