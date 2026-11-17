/**
 * The album print (round five, #28): the real cover, read once per track
 * as 22 × 22 pixels through FFmpeg (a separate program Dashi runs, under its
 * own licence: LGPL/GPL), turned into a two-ink halftone and kept, so Metal
 * is handed two masks and never the cover itself. The sleeve's colour is the
 * cover's dominant hue clamped to H300–335 and chroma ≤ 0.12, else plain
 * ink; its bright shape stays under 40 % of the square.
 */

import { fileURLToPath } from "node:url";
import { hexToOklch, oklchToHex } from "@dashi/ui";

export const ART_GRID = 22;

export interface Print {
  /** Brightness 0–1 per cell, row by row. */
  cells: readonly number[];
  /** The sleeve's colour (Light and Dark), or null: plain ink. */
  sleeve: { light: string; dark: string } | null;
}

const prints = new Map<string, Promise<Print | null>>();

/** The cover's 22 × 22 RGB, or null when there is no cover or no FFmpeg. */
async function readPixels(url: string): Promise<Uint8Array | null> {
  let input = url;
  if (url.startsWith("file://")) input = fileURLToPath(url);
  else if (!url.startsWith("https://")) return null;
  try {
    const process = Bun.spawn(
      ["ffmpeg", "-v", "quiet", "-i", input, "-vf", `scale=${ART_GRID}:${ART_GRID}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-frames:v", "1", "-"],
      {
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    const bytes = new Uint8Array(await new Response(process.stdout).arrayBuffer());
    await process.exited;
    return bytes.length === ART_GRID * ART_GRID * 3 ? bytes : null;
  } catch {
    return null;
  }
}

/** Brightness per cell, and the sleeve's colour from the pixels. */
export function printOf(rgb: Uint8Array): Print {
  const cells: number[] = [];
  const hues = new Map<number, number>();
  for (let i = 0; i < rgb.length; i += 3) {
    const [r, g, b] = [rgb[i] ?? 0, rgb[i + 1] ?? 0, rgb[i + 2] ?? 0];
    cells.push((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255);
    const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    const lch = hexToOklch(hex);
    if (lch.C > 0.04) hues.set(Math.round(lch.H / 10) * 10, (hues.get(Math.round(lch.H / 10) * 10) ?? 0) + lch.C);
  }
  const [hue] = [...hues].sort((a, b) => b[1] - a[1])[0] ?? [null];
  // The band is H300–335: a cover outside it prints in plain ink.
  const sleeve =
    hue !== null && hue >= 290 && hue <= 345
      ? {
          light: oklchToHex({ L: 0.5, C: 0.12, H: Math.min(335, Math.max(300, hue)) }),
          dark: oklchToHex({ L: 0.72, C: 0.11, H: Math.min(335, Math.max(300, hue)) }),
        }
      : null;
  return { cells, sleeve };
}

/** A track's print, made once per cover address and kept. */
export function coverPrint(url: string): Promise<Print | null> {
  let hit = prints.get(url);
  if (!hit) {
    hit = readPixels(url).then((rgb) => (rgb ? printOf(rgb) : null));
    prints.set(url, hit);
    if (prints.size > 32) prints.delete(prints.keys().next().value ?? "");
  }
  return hit;
}

/** A print from a title when there is no cover: a gentle ramp, the same for the same title. */
export function stockPrint(seed: string): Print {
  let n = 0;
  for (const char of seed) n = (n * 31 + (char.codePointAt(0) ?? 0)) % 997;
  const cells: number[] = [];
  for (let y = 0; y < ART_GRID; y++)
    for (let x = 0; x < ART_GRID; x++) cells.push(Math.min(1, Math.max(0, 0.15 + (y / ART_GRID) * 0.55 + Math.sin(x * 0.7 + n) * 0.05)));
  return { cells, sleeve: null };
}

/**
 * The halftone as two masks: the disc (radius 0.3 of the square, about 28 %,
 * under the 40 % the design allows) in the sleeve's colour, the rest in ink.
 */
export function halftone(print: Print): { ink: string; sleeve: string } {
  const p = 10;
  const ink: string[] = [];
  const sleeve: string[] = [];
  for (let y = 0; y < ART_GRID; y++)
    for (let x = 0; x < ART_GRID; x++) {
      const v = print.cells[y * ART_GRID + x] ?? 0;
      const d = Math.hypot(x - ART_GRID * 0.62, y - ART_GRID * 0.7) / ART_GRID;
      const r = p * 0.48 * Math.min(1, Math.max(0.12, 1 - v + (d < 0.3 ? 0.2 : 0)));
      (d < 0.3 ? sleeve : ink).push(`<circle cx="${(x + 0.5) * p}" cy="${(y + 0.5) * p}" r="${r.toFixed(1)}" fill="#000"/>`);
    }
  const svg = (body: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ART_GRID * p} ${ART_GRID * p}">${body.join("")}</svg>`;
  return { ink: svg(ink), sleeve: svg(sleeve) };
}
