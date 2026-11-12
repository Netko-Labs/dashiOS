/**
 * Where Software keeps what it fetched: `$XDG_CACHE_HOME/dashi/software/`
 * (`~/.cache` when the variable is unset or not an absolute path, as the XDG
 * spec says). JSON answers and images live in their own folders; file names
 * are a hash of the key or URL, so nothing a server sends reaches a path.
 */

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

export function cacheRoot(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  const base = env.XDG_CACHE_HOME;
  return join(base && isAbsolute(base) ? base : join(home, ".cache"), "dashi/software");
}

/** A short, stable, filename-safe name for a key (a URL, a request). */
export function digest(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

export const jsonDir = (root: string): string => join(root, "json");
export const imageDir = (root: string): string => join(root, "images");
export const jsonPath = (root: string, key: string): string => join(jsonDir(root), `${digest(key)}.json`);
export const imagePath = (root: string, url: string, extension: string): string => join(imageDir(root), `${digest(url)}.${extension}`);
