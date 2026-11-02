/**
 * The on-disk cache: parsed-before-use JSON answers and downloaded images
 * under `$XDG_CACHE_HOME/dashi/software/`. Both have limits: a single entry
 * over its cap is not stored, and when a folder passes its total the oldest
 * files go first. A file is only ever read back as what it was stored as
 * (JSON text, or an image whose first bytes say PNG, JPEG, WebP, or GIF).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageDir, imagePath, jsonDir, jsonPath } from "./paths.ts";

export const LIMITS = {
  jsonEntry: 2_000_000,
  jsonTotal: 24_000_000,
  imageEntry: 6_000_000,
  imageTotal: 120_000_000,
} as const;

/** The extension for an image's first bytes, or null when it is not a kind Metal draws. */
export function imageKind(bytes: Uint8Array): "png" | "jpg" | "webp" | "gif" | null {
  const at = (index: number): number => bytes[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "jpg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return "gif";
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50)
    return "webp";
  return null;
}

/** Deletes the oldest files in `dir` until what is left is at most `limit` bytes. */
export function trim(dir: string, limit: number): void {
  let files: Array<{ path: string; size: number; at: number }>;
  try {
    files = readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      try {
        const info = statSync(path);
        return info.isFile() ? [{ path, size: info.size, at: info.mtimeMs }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return;
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.at - b.at)) {
    if (total <= limit) break;
    rmSync(file.path, { force: true });
    total -= file.size;
  }
}

function write(path: string, data: string | Uint8Array): void {
  mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
  // Written beside and renamed over, so a reader never sees half a file.
  const part = `${path}.${process.pid}.part`;
  writeFileSync(part, data, { mode: 0o600 });
  renameSync(part, path);
}

export interface Cached<T> {
  value: T;
  /** Milliseconds since it was stored. */
  age: number;
}

export class JsonCache {
  constructor(
    private readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): Cached<unknown> | null {
    const path = jsonPath(this.root, key);
    try {
      const info = statSync(path);
      if (info.size > LIMITS.jsonEntry) return null;
      return { value: JSON.parse(readFileSync(path, "utf8")) as unknown, age: Math.max(0, this.now() - info.mtimeMs) };
    } catch {
      return null;
    }
  }

  put(key: string, value: unknown): void {
    try {
      const text = JSON.stringify(value);
      if (text.length > LIMITS.jsonEntry) return;
      write(jsonPath(this.root, key), text);
      trim(jsonDir(this.root), LIMITS.jsonTotal);
    } catch (error) {
      console.error("dashi-software: could not cache an answer:", error);
    }
  }
}

export class ImageCache {
  constructor(private readonly root: string) {}

  /** The file for `url` if it is cached (touched, so it is the newest). */
  get(url: string): string | null {
    for (const extension of ["png", "jpg", "webp", "gif"]) {
      const path = imagePath(this.root, url, extension);
      if (existsSync(path)) {
        try {
          const now = new Date();
          utimesSync(path, now, now);
        } catch {
          // Not touching it only makes it older.
        }
        return path;
      }
    }
    return null;
  }

  /** Stores `bytes` for `url`; the path, or null when they are too large or not an image. */
  put(url: string, bytes: Uint8Array): string | null {
    const kind = imageKind(bytes);
    if (kind === null || bytes.length > LIMITS.imageEntry) return null;
    const path = imagePath(this.root, url, kind);
    try {
      write(path, bytes);
      trim(imageDir(this.root), LIMITS.imageTotal);
      return path;
    } catch (error) {
      console.error("dashi-software: could not cache an image:", error);
      return null;
    }
  }
}
