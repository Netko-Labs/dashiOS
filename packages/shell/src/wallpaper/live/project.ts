/**
 * A Wallpaper Engine item's `project.json`, read strictly. Workshop items
 * are made by strangers and downloaded: every field is checked for its kind,
 * a name that will be joined to a folder must be a plain file name, and a
 * file the item points at must be inside the item's folder (a symlink that
 * leaves it is refused).
 */

import { realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";

/** The types linux-wallpaperengine plays that Dashi offers. */
export const PROJECT_TYPES = ["scene", "video", "web"] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export interface WorkshopItem {
  /** The Workshop id: the folder's name. */
  id: string;
  /** The item's folder, absolute. */
  dir: string;
  title: string;
  type: ProjectType;
  /** What the project plays: a video's file name, a scene's `scene.json`. */
  file: string;
  /** The preview image (absolute), when the item has a usable one. */
  preview: string | null;
}

export type ProjectResult = { ok: true; item: WorkshopItem } | { ok: false; reason: string };

/** Larger than this is not a project file. */
export const MAX_PROJECT_BYTES = 1024 * 1024;
const PREVIEW_EXTENSIONS = /\.(?:png|jpe?g|gif)$/i;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A single file name: no folders, no `..`, no control characters. */
export function isPlainName(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 255 && !/[/\\\0-\x1f\x7f]/.test(value) && value !== "." && value !== "..";
}

/** Whether `name` is a regular file inside `dir` once links are followed (one that leaves `dir` does not count). */
export function isFileInside(dir: string, name: string): boolean {
  try {
    const path = join(dir, name);
    if (!statSync(path).isFile()) return false;
    return realpathSync(path).startsWith(realpathSync(dir) + sep);
  } catch {
    return false;
  }
}

/** The item `text` (the contents of `dir/project.json`) describes, or why it is not usable. */
export function parseProject(text: string, dir: string, id: string, fileInside: (dir: string, name: string) => boolean = isFileInside): ProjectResult {
  if (!/^[0-9]{1,20}$/.test(id)) return { ok: false, reason: "not a Workshop folder" };
  if (text.length > MAX_PROJECT_BYTES) return { ok: false, reason: "project.json is too large" };
  let value: unknown;
  try {
    // Some items start with a byte order mark.
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, reason: "project.json is not JSON" };
  }
  if (!isRecord(value)) return { ok: false, reason: "project.json is not an object" };
  const { title, type, file, preview } = value;
  if (typeof title !== "string" || title.trim() === "" || title.length > 200 || /[\0-\x1f\x7f]/.test(title)) return { ok: false, reason: "no usable title" };
  const kind = typeof type === "string" ? type.toLowerCase() : "";
  const known = PROJECT_TYPES.find((candidate) => candidate === kind);
  if (!known) return { ok: false, reason: `unsupported type ${JSON.stringify(type)}` };
  if (!isPlainName(file)) return { ok: false, reason: "no usable file" };
  // A scene lives in a package the renderer opens; only a video's file is ours to check.
  if (known === "video" && !fileInside(dir, file)) return { ok: false, reason: "the video file is missing" };
  const previewPath = isPlainName(preview) && PREVIEW_EXTENSIONS.test(preview) && fileInside(dir, preview) ? join(dir, preview) : null;
  return { ok: true, item: { id, dir, title: title.trim(), type: known, file, preview: previewPath } };
}
