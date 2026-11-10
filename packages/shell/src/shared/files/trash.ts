/** The Trash's bookkeeping: `.trashinfo` files record where a trashed item came from and when it was trashed. */

import { normalizePath } from "./paths.ts";

export interface TrashInfo {
  /** Where it was before it was trashed. */
  originalPath: string;
  /** Milliseconds since the epoch, local time as the specification writes it; null when missing or unreadable. */
  deletedAt: number | null;
}

/** Percent-decodes the `Path=` value (the specification percent-encodes it). */
export function parseTrashInfo(text: string): TrashInfo | null {
  let inInfo = false;
  let raw: string | null = null;
  let date: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inInfo = trimmed === "[Trash Info]";
      continue;
    }
    if (!inInfo) continue;
    if (trimmed.startsWith("Path=") && raw === null) raw = trimmed.slice(5);
    else if (trimmed.startsWith("DeletionDate=") && date === null) date = trimmed.slice(13);
  }
  if (raw === null) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const originalPath = normalizePath(decoded);
  if (originalPath === null) return null;
  const parsed = date ? Date.parse(date) : Number.NaN;
  return { originalPath, deletedAt: Number.isFinite(parsed) ? parsed : null };
}
