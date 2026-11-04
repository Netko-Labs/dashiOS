/**
 * Drag and drop in Files, as in the Mac's Finder: a drag carries the item
 * pressed, or the whole selection when the item is part of it. A drop on a
 * folder (a tile, a row, a sidebar place, the folder's own background) moves
 * the items when they're on the same disk and copies them from another one;
 * ⌥ or Ctrl copies, ⇧ moves. The Trash takes them as a move to the Trash.
 * Files from other apps arrive the same way (`onDrop`, any app's drag).
 */

import { statSync } from "node:fs";
import { parentOf } from "./paths.ts";

export type DropMode = "move" | "copy";

/** What a press on `path` drags: the selection when it holds `path`, else `path` alone. */
export function dragPaths(path: string, selection: readonly string[]): string[] {
  return selection.includes(path) ? [...selection] : [path];
}

/** Whether `path` is `folder` or inside it. */
const within = (path: string, folder: string): boolean => path === folder || path.startsWith(folder === "/" ? "/" : `${folder}/`);

export interface DropKeys {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/**
 * What a drop of `paths` on the folder `dest` does: move or copy them, and
 * which (a move leaves out what's already there). Null when nothing would
 * happen, or a folder would go inside itself. `sameDisk` says whether two
 * paths are on one filesystem.
 */
export function dropChoice(
  paths: readonly string[],
  dest: string,
  keys: DropKeys,
  sameDisk: (a: string, b: string) => boolean = onSameDisk,
): { mode: DropMode; paths: string[] } | null {
  if (paths.length === 0 || paths.some((path) => within(dest, path))) return null;
  const mode: DropMode = keys.alt || keys.ctrl ? "copy" : keys.shift ? "move" : paths.every((path) => sameDisk(parentOf(path), dest)) ? "move" : "copy";
  const moving = mode === "move" ? paths.filter((path) => parentOf(path) !== dest) : [...paths];
  return moving.length > 0 ? { mode, paths: moving } : null;
}

/** Whether `a` and `b` are on one filesystem (a move there is a rename). Unknown counts as not. */
export function onSameDisk(a: string, b: string): boolean {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return false;
  }
}
