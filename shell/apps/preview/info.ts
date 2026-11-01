/** The facts the info sheet shows, and how they are written. */

import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { FORMATS, type Format } from "./kinds.ts";

/** 1,234 bytes as "1.2 KB": decimal units, as the Files app and most file managers write them. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1000) return `${bytes} ${bytes === 1 ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

export function formatDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

/** "4032 × 3024", or "4,032 × 3,024" with thousands separators. */
export function formatDimensions(width: number, height: number): string {
  return `${width.toLocaleString("en-US")} × ${height.toLocaleString("en-US")}`;
}

/** Megapixels, one decimal: "12.2 MP"; empty under a tenth. */
export function megapixels(width: number, height: number): string {
  const mp = (width * height) / 1_000_000;
  return mp >= 0.1 ? `${Math.round(mp * 10) / 10} MP` : "";
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

export function factsFor(path: string, format: Format | null): FileFacts | null {
  try {
    const stat = statSync(path);
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
  } catch {
    return null;
  }
}
