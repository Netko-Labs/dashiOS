/**
 * What System Settings' Wallpaper pane lists and how it takes a photo: pure
 * functions over the settings, so the pane only draws.
 */

import { statSync } from "node:fs";
import { basename, extname } from "node:path";
import { MAX_PHOTOS } from "../settings-app/store.ts";
import { isPhotoPath } from "../shared/settings/file.ts";
import { BUNDLED, DEFAULT_WALLPAPER, thumbnailPath } from "./catalog.ts";

export interface WallpaperTile {
  /** What goes in settings.json: a bundled name, or a photo's path. */
  ref: string;
  title: string;
  /** The picture the tile shows: a small thumbnail, or the photo itself. */
  image: string;
  photo: boolean;
}

/** The bundled wallpapers, then the photos the person added (newest first) that are still there. */
export function wallpaperTiles(photos: readonly string[], exists: (path: string) => boolean = isFile): WallpaperTile[] {
  const bundled = BUNDLED.map((entry): WallpaperTile => ({ ref: entry.id, title: entry.title, image: thumbnailPath(entry.id), photo: false }));
  const added = photos.filter(exists).map((path): WallpaperTile => ({ ref: path, title: basename(path, extname(path)), image: path, photo: true }));
  return [...bundled, ...added];
}

/** `photos` with `path` first, once, and no more than the file keeps. */
export function withPhoto(photos: readonly string[], path: string): string[] {
  return [path, ...photos.filter((photo) => photo !== path)].slice(0, MAX_PHOTOS);
}

/** What `settings.patch("wallpaper", …)` should hold for choosing `ref`: the default is the absence of a path. */
export const pathFor = (ref: string): string | undefined => (ref === DEFAULT_WALLPAPER ? undefined : ref);

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

/** Why `typed` (a path someone typed or the portal gave) cannot be a wallpaper, or null when it can. */
export function photoProblem(typed: string, exists: (path: string) => boolean = isFile): string | null {
  const path = typed.trim();
  if (path === "") return "Type the full path of a photo.";
  if (!isPhotoPath(path)) return "The path must start with /.";
  if (!EXTENSIONS.has(extname(path).toLowerCase())) return "Only PNG and JPEG photos can be used.";
  return exists(path) ? null : "There is no such file.";
}
