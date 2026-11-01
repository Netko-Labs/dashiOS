/**
 * ImageMagick, for what Metal cannot draw as it is: a picture that is too
 * large, one that needs its EXIF turn applied, one turned in the view, and the
 * formats Metal does not read (HEIC, AVIF, JPEG XL). The file goes in on
 * standard input under an explicit coder (`png:-`), chosen from the file's
 * own header, so ImageMagick never guesses a format from a name, never parses
 * the path (globs, `[0]` suffixes, `msl:`-style prefixes), and the only coders
 * a hostile file can reach are the ones listed in kinds.ts.
 */

import { FORMATS, type Format } from "./kinds.ts";

/** The most pixels Metal is handed as they are; larger pictures are reduced first. */
export const MAX_NATIVE_PIXELS = 48_000_000;
/** A reduced picture has at most this many pixels (a bit under MAX_NATIVE_PIXELS, so what is made is always drawn as it is). */
export const REDUCED_PIXELS = 36_000_000;
/** Time and memory ImageMagick may use for one picture. */
export const CONVERT_TIMEOUT_MS = 60_000;
export const CONVERT_MEMORY_MIB = 3072;

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

/** The `magick` arguments: file on standard input, a PNG at `output`. Null for a format it must not read. */
export function magickArgs(request: ConvertRequest): string[] | null {
  const coder = FORMATS[request.format].coder;
  if (!coder) return null;
  const degrees = ((Math.trunc(request.turns) % 4) + 4) % 4 * 90;
  return [
    "magick",
    "-limit", "memory", "1GiB",
    "-limit", "map", "2GiB",
    "-limit", "disk", "0",
    "-limit", "time", "50",
    "-limit", "area", "700MP",
    "-limit", "width", "65000",
    "-limit", "height", "65000",
    // The first frame of an animation or a multi-page file.
    `${coder}:-[0]`,
    "-auto-orient",
    ...(degrees ? ["-rotate", String(degrees)] : []),
    "-resize", `${request.maxPixels}@>`,
    "-define", "png:compression-level=1",
    `png:${request.output}`,
  ];
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

/** Formats a turned copy can be saved in without losing what the file is (an animation or a modern codec would be flattened or re-encoded badly). */
const SAVEABLE: ReadonlySet<Format> = new Set(["png", "jpeg", "webp", "bmp", "tiff"]);

export const canSaveCopy = (format: Format): boolean => SAVEABLE.has(format);

/** The arguments to write a turned copy: the file on standard input, the same format at `output` (a clean name of ours; the caller puts it beside the original). */
export function saveCopyArgs(format: Format, turns: number, output: string): string[] | null {
  const coder = FORMATS[format].coder;
  if (!coder || !SAVEABLE.has(format)) return null;
  const degrees = ((Math.trunc(turns) % 4) + 4) % 4 * 90;
  return [
    "magick",
    "-limit", "memory", "1GiB",
    "-limit", "map", "2GiB",
    "-limit", "disk", "0",
    "-limit", "time", "50",
    `${coder}:-[0]`,
    "-auto-orient",
    ...(degrees ? ["-rotate", String(degrees)] : []),
    ...(format === "jpeg" ? ["-quality", "95"] : []),
    `${coder}:${output}`,
  ];
}

/** `name.jpg` → `name rotated.jpg`, `name rotated 2.jpg`, …: the first name `taken` does not hold. */
export function copyName(name: string, taken: (candidate: string) => boolean): string {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; n < 1000; n++) {
    const candidate = `${stem} rotated${n === 1 ? "" : ` ${n}`}${extension}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} rotated ${Date.now()}${extension}`;
}
