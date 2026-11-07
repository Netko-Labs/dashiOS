/**
 * ImageMagick, for what Metal cannot draw as it is: a picture that is too
 * large, one that needs its EXIF turn applied, one rotated in the view, and
 * the formats Metal does not read (HEIC, AVIF, JPEG XL); and for the copies
 * Preview writes (Export, a page or picture for Print, thumbnails of a
 * folder's pictures, a rotated PDF page). A file from the person goes in on
 * standard input under an explicit coder (`png:-`), chosen from the file's
 * own header, so ImageMagick never guesses a format from a name, never parses
 * the path (globs, `[0]` suffixes, `msl:`-style prefixes), and the only coders
 * a hostile file can reach are the ones listed in kinds.ts. Paths it writes,
 * and the PNGs of ours it reads back, are names Preview made.
 */

import { FORMATS, type Format } from "./kinds.ts";

/** The most pixels Metal is handed as they are; larger pictures are reduced first. */
export const MAX_NATIVE_PIXELS = 48_000_000;
/** A reduced picture has at most this many pixels (a bit under MAX_NATIVE_PIXELS, so what is made is always drawn as it is). */
export const REDUCED_PIXELS = 36_000_000;
/** Time and memory ImageMagick may use for one picture. */
export const CONVERT_TIMEOUT_MS = 60_000;
export const CONVERT_MEMORY_MIB = 3072;
/** A folder picture's thumbnail is at most this many pixels on a side (150 drawn, twice for HiDPI). */
export const THUMB_SIDE = 300;

export interface ConvertRequest {
  format: Format;
  /** Quarter turns clockwise to apply after the EXIF turn. */
  turns: number;
  /** Reduce to at most this many pixels in all (never enlarges). */
  maxPixels: number;
  output: string;
}

/** Whether ImageMagick may be asked to read this format (SVG and PDF are never handed to it). */
export const convertible = (format: Format): boolean => FORMATS[format].coder !== undefined;

const degreesOf = (turns: number): number => (((Math.trunc(turns) % 4) + 4) % 4) * 90;

/** The resource limits every run starts with. */
const LIMITS = [
  "magick",
  "-limit",
  "memory",
  "1GiB",
  "-limit",
  "map",
  "2GiB",
  "-limit",
  "disk",
  "0",
  "-limit",
  "time",
  "50",
  "-limit",
  "area",
  "700MP",
  "-limit",
  "width",
  "65000",
  "-limit",
  "height",
  "65000",
] as const;

/** The file on standard input, upright: its first frame (of an animation or a multi-page file), the EXIF turn applied, then `turns`. */
function uprightInput(coder: string, turns: number): string[] {
  const degrees = degreesOf(turns);
  return [`${coder}:-[0]`, "-auto-orient", ...(degrees ? ["-rotate", String(degrees)] : [])];
}

/** The `magick` arguments: file on standard input, a PNG at `output`. Null for a format it must not read. */
export function magickArgs(request: ConvertRequest): string[] | null {
  const coder = FORMATS[request.format].coder;
  if (!coder) return null;
  return [...LIMITS, ...uprightInput(coder, request.turns), "-resize", `${request.maxPixels}@>`, "-define", "png:compression-level=1", `png:${request.output}`];
}

/** A small upright copy of a picture for the page strip: the file on standard input, a PNG at `output`. */
export function thumbnailArgs(format: Format, output: string): string[] | null {
  const coder = FORMATS[format].coder;
  if (!coder) return null;
  return [...LIMITS, ...uprightInput(coder, 0), "-thumbnail", `${THUMB_SIDE}x${THUMB_SIDE}>`, `png:${output}`];
}

/** One of Preview's own PNGs (a rendered page) turned `turns` quarter turns, as a PNG at `output`. */
export function turnPngArgs(input: string, turns: number, output: string): string[] {
  return [...LIMITS, `png:${input}`, "-rotate", String(degreesOf(turns)), "-define", "png:compression-level=1", `png:${output}`];
}

/** What Export writes. */
export type ExportFormat = "png" | "jpeg" | "pdf";

export const EXPORT_FORMATS: Readonly<Record<ExportFormat, { label: string; extension: string; mime: string }>> = {
  png: { label: "PNG", extension: "png", mime: "image/png" },
  jpeg: { label: "JPEG", extension: "jpg", mime: "image/jpeg" },
  pdf: { label: "PDF", extension: "pdf", mime: "application/pdf" },
};

/**
 * A picture (on standard input) written upright and rotated as it is shown,
 * as PNG, JPEG (at `quality`, 1 to 100, transparency on white) or a
 * one-page PDF, at `output`. Null for a format ImageMagick must not read.
 */
export function exportImageArgs(format: Format, turns: number, to: ExportFormat, quality: number, output: string): string[] | null {
  const coder = FORMATS[format].coder;
  if (!coder) return null;
  const q = String(Math.round(Math.min(100, Math.max(1, quality))));
  const how = to === "jpeg" ? ["-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", q] : to === "pdf" ? ["-quality", q] : [];
  return [...LIMITS, ...uprightInput(coder, turns), ...how, `${to}:${output}`];
}

/** One of Preview's own PNGs written as JPEG or PDF (a PDF page exported, or a page to print). */
export function convertPngArgs(input: string, to: ExportFormat, quality: number, output: string): string[] {
  const q = String(Math.round(Math.min(100, Math.max(1, quality))));
  const how = to === "jpeg" ? ["-background", "white", "-alpha", "remove", "-alpha", "off", "-quality", q] : to === "pdf" ? ["-quality", q] : [];
  return [...LIMITS, `png:${input}`, ...how, `${to}:${output}`];
}

/** `magick -list format` lines: the formats it can read, lowercased. */
export function parseReadable(listing: string): Set<string> {
  const readable = new Set<string>();
  for (const line of listing.split("\n")) {
    const match = /^\s*([A-Z0-9_-]+)\*?\s+\S+\s+(r|-)(w|-)(\+|-)\s/.exec(line);
    if (match && match[2] === "r") readable.add((match[1] as string).toLowerCase());
  }
  return readable;
}
