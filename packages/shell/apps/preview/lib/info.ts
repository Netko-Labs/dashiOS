/**
 * The facts the info sheet shows, and how its counts are written, in the
 * system's locale; sizes and dates are written by the file browser's one
 * formatter (docs/design.html PA-14, `src/shared/file-browser/format.ts`). The facts come from the stat the open already did, so
 * nothing here touches the disk.
 */

import { basename, dirname } from "node:path";
import { FORMATS, type Format } from "../../../src/shared/files/kinds.ts";

/** A whole number with the locale's grouping: "4,032". */
export const formatCount = (value: number, locale?: string): string => new Intl.NumberFormat(locale).format(value);

/** "4,032 × 3,024", grouped as the locale groups. */
export function formatDimensions(width: number, height: number, locale?: string): string {
  return `${formatCount(width, locale)} × ${formatCount(height, locale)}`;
}

/** Megapixels, one decimal: "12.2 MP"; empty under a tenth. */
export function megapixels(width: number, height: number, locale?: string): string {
  const mp = (width * height) / 1_000_000;
  return mp >= 0.1 ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mp)} MP` : "";
}

export interface FileFacts {
  name: string;
  folder: string;
  path: string;
  size: number;
  modifiedMs: number;
  type: string;
  mime: string;
}

/** The facts of a file from what its stat said. */
export function factsFrom(path: string, stat: { size: number; mtimeMs: number }, format: Format | null): FileFacts {
  const info = format ? FORMATS[format] : null;
  return {
    name: basename(path),
    folder: dirname(path),
    path,
    size: stat.size,
    modifiedMs: stat.mtimeMs,
    type: info?.label ?? "File",
    mime: info?.mime ?? "application/octet-stream",
  };
}
