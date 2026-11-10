/**
 * Pictures for items: a thumbnail from the freedesktop cache or, for a small
 * picture, the picture itself; else Dashi's icon for the item's kind
 * (file-icons.ts, IC-2), in Light or Dark, with a special folder's emblem.
 */

import { dataDirs } from "../../src/shared/apps/index.ts";
import type { FileItem } from "../../src/shared/files/items.ts";
import type { UserDirName } from "../../src/shared/files/xdg.ts";
import { type Emblem, iconFile, iconKind } from "./file-icons.ts";
import { type ThumbnailMaker, thumbnailMaker } from "./thumbnailer.ts";
import { findThumbnail } from "./thumbs.ts";

/** Picture formats the renderer draws, and the biggest original worth decoding for a tile. */
const DRAWABLE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const ORIGINAL_LIMIT = 1_500_000;

/** The thumbnail maker for `cacheDir` (thumbnailer.ts), on the system's thumbnailers. */
export const thumbnails = (cacheDir: string): ThumbnailMaker => thumbnailMaker(cacheDir, dataDirs);

/** Which folder wears which emblem: the home folder and the person's own folders, as the sidebar draws them. */
export type Emblems = ReadonlyMap<string, Emblem>;

const DIR_EMBLEMS: Record<UserDirName, Emblem> = {
  DESKTOP: "desktop",
  DOCUMENTS: "documents",
  DOWNLOAD: "downloads",
  PICTURES: "pictures",
  MUSIC: "music",
  VIDEOS: "videos",
};

export function folderEmblems(dirs: ReadonlyArray<{ name: UserDirName; path: string }>, home: string): Emblems {
  return new Map<string, Emblem>([
    [home, "home"],
    ...dirs.filter((dir) => dir.path !== home).map((dir): [string, Emblem] => [dir.path, DIR_EMBLEMS[dir.name]]),
  ]);
}

/**
 * A picture of the file itself: a cached thumbnail, or a small original.
 * Null for anything else; then, when a thumbnailer can make one, it is asked
 * to (the maker's listeners hear when it lands).
 */
export function previewFor(item: FileItem, pixels: number, cacheDir: string): string | null {
  if (item.kind !== "file") return null;
  const cached = findThumbnail(item.path, item.mtime, pixels, cacheDir);
  if (cached) return cached;
  if (DRAWABLE.has(item.mime) && item.size <= ORIGINAL_LIMIT) return item.path;
  thumbnails(cacheDir).request({ path: item.path, mime: item.mime, mtimeMs: item.mtime });
  return null;
}

/** Dashi's icon for an item, in Dark Mode's colors when `dark`. */
export function iconFor(item: Pick<FileItem, "kind" | "mime" | "path">, dark = false, emblems?: Emblems): string {
  return iconFile(iconKind(item, item.kind === "folder" ? emblems?.get(item.path) : undefined), dark);
}
