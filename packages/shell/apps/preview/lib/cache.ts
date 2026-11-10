/**
 * Preview's cache: rendered PDF pages, thumbnails, and converted or rotated
 * images, under `$XDG_CACHE_HOME/dashi/preview/`. A file's entries are named
 * by a hash of its path, modification time, and size plus what was asked of
 * it (a page and a resolution, a rotation), so an edited file never shows a
 * stale picture, and the folder is pruned to a size and an age so it cannot
 * grow without end.
 */

import { chmodSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** What the cache may hold, and for how long. */
export const MAX_CACHE_BYTES = 512 * 1024 * 1024;
export const MAX_CACHE_AGE_MS = 30 * 24 * 3600 * 1000;

export interface Stamp {
  path: string;
  mtimeMs: number;
  size: number;
}

/** `$XDG_CACHE_HOME/dashi/preview`; an empty variable counts as unset. */
export function cacheRoot(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "dashi", "preview");
}

/** A name for what was asked of a file in this state: stable, and different when the file or the request is. */
export function cacheKey(stamp: Stamp, request: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(JSON.stringify([stamp.path, Math.floor(stamp.mtimeMs), stamp.size, request]));
  return hasher.digest("hex").slice(0, 40);
}

/** The file for a key in a root, with an extension (`png`). */
export const cacheFile = (root: string, key: string, extension: string): string => join(root, `${key}.${extension}`);

/** A private folder, made if missing. */
export function ensureCache(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    chmodSync(root, 0o700);
  } catch {
    // Not ours to change (a shared mount): carry on.
  }
}

/** A name next to `file` for a write in progress; renamed over `file` when whole, so a reader never sees half a picture. */
export const partialName = (file: string): string => `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.part`;

export function publish(partial: string, file: string): void {
  renameSync(partial, file);
}

export interface CacheEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

/** Which entries to delete: everything older than `maxAgeMs`, then the oldest until the rest fit in `maxBytes`. */
export function pruneList(entries: readonly CacheEntry[], now: number, maxBytes: number = MAX_CACHE_BYTES, maxAgeMs: number = MAX_CACHE_AGE_MS): string[] {
  const doomed = new Set<string>();
  const live: CacheEntry[] = [];
  for (const entry of entries) {
    if (now - entry.mtimeMs > maxAgeMs) doomed.add(entry.path);
    else live.push(entry);
  }
  let total = live.reduce((sum, entry) => sum + entry.size, 0);
  for (const entry of live.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= maxBytes) break;
    doomed.add(entry.path);
    total -= entry.size;
  }
  return [...doomed];
}

/** Delete what `pruneList` names from the cache folder (regular files only; leftovers of a crashed write go too). */
export function pruneCache(root: string, now: number = Date.now()): number {
  let names: string[] = [];
  try {
    names = readdirSync(root);
  } catch {
    return 0;
  }
  const entries: CacheEntry[] = [];
  for (const name of names) {
    const path = join(root, name);
    try {
      const stat = statSync(path);
      if (stat.isFile()) entries.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // Gone already.
    }
  }
  const doomed = pruneList(entries, now);
  for (const path of doomed) rmSync(path, { force: true });
  return doomed.length;
}
