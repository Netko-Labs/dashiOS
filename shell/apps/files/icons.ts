/**
 * Pictures for items: a thumbnail from the freedesktop cache or, for a small
 * picture, the picture itself; else the icon theme's icon for the file's type;
 * else one of the icons bundled in `icons/` (a folder and a page with a badge
 * per category), so a machine without the theme still looks right.
 */

import { join } from "node:path";
import { dataDirs } from "../../src/entries.ts";
import { themeIcon } from "../../src/icon-themes.ts";
import type { FileItem } from "./items.ts";
import { categoryOf, iconNames, INODE_DIRECTORY, UNKNOWN_TYPE } from "./mime.ts";
import { findThumbnail } from "./thumbs.ts";

const bundled = new URL("./icons/", import.meta.url).pathname;
const roots = (): string[] => dataDirs().map((dir) => join(dir, "icons"));
const cache = new Map<string, string>();

/** The icon for a type: the theme's, else the bundled one for its category. */
export function typeIcon(mime: string): string {
  const known = cache.get(mime);
  if (known) return known;
  let path: string | null = null;
  // The theme's icon for "unknown" is a question mark: the bundled page says "a file" better.
  if (process.env.DASHI_FILES_ICONS !== "bundled" && mime !== UNKNOWN_TYPE) {
    for (const name of iconNames(mime)) {
      // Not the catch-all "text-x-generic" for a type of its own: the bundled badge says more.
      if (name === "text-x-generic" && mime !== "text/plain" && categoryOf(mime) !== "text") break;
      path = themeIcon(name, roots(), ["mimetypes", "places"]);
      if (path) break;
    }
  }
  const category = categoryOf(mime);
  path ??= `${bundled}${category}.svg`;
  cache.set(mime, path);
  return path;
}

export const folderIcon = (): string => typeIcon(INODE_DIRECTORY);

/** Picture formats the renderer draws, and the biggest original worth decoding for a tile. */
const DRAWABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ORIGINAL_LIMIT = 1_500_000;

/** A picture of the file itself: a cached thumbnail, or a small original. Null for anything else. */
export function previewFor(item: FileItem, pixels: number, cacheDir: string): string | null {
  if (item.kind !== "file" || !DRAWABLE.has(item.mime)) return null;
  return findThumbnail(item.path, item.mtime, pixels, cacheDir) ?? (item.size <= ORIGINAL_LIMIT ? item.path : null);
}

export function iconFor(item: Pick<FileItem, "kind" | "mime" | "broken">): string {
  return item.kind === "folder" ? folderIcon() : typeIcon(item.mime);
}
