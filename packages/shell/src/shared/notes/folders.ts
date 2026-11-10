/**
 * Folders in the notes root: one level deep, named by people. Making,
 * renaming, and checking them. Deleting one (its notes go to Recently Deleted)
 * is in store.ts, since it moves notes.
 */

import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { isRealDirectory } from "../fs/atomic.ts";
import { DEFAULT_FOLDER_NAME, sanitizeName, uniqueName } from "./names.ts";
import { TRASH_DIR } from "./recently-deleted.ts";
import { updateSidecar } from "./sidecar.ts";
import { NotesError } from "./types.ts";

/** Names a new folder must not take: the folders there are, and the default folder's own name. */
function folderNames(root: string): string[] {
  const here = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return [...here, DEFAULT_FOLDER_NAME, TRASH_DIR];
}

export function requireFolder(root: string, name: string): void {
  if (name === "" || name.startsWith(".") || name.includes("/") || !isRealDirectory(join(root, name)))
    throw new NotesError(`There is no folder ${JSON.stringify(name)}.`);
}

/** The folder to write into: "" or an existing folder, or one made from `folder`'s sanitized name. */
export function ensureFolder(root: string, folder: string): string {
  if (folder === "") return "";
  const clean = sanitizeName(folder, "New Folder");
  if (clean.toLowerCase() === DEFAULT_FOLDER_NAME.toLowerCase()) return "";
  const existing = readdirSync(root, { withFileTypes: true }).find((entry) => entry.isDirectory() && entry.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing.name;
  mkdirSync(join(root, clean));
  return clean;
}

/** Makes a folder; returns the name it got (sanitized, made unique). */
export function createFolder(root: string, name: string): string {
  const clean = uniqueName(sanitizeName(name, "New Folder"), folderNames(root), "");
  mkdirSync(join(root, clean));
  return clean;
}

export function renameFolder(root: string, from: string, name: string): string {
  requireFolder(root, from);
  const others = folderNames(root).filter((each) => each.toLowerCase() !== from.toLowerCase());
  const clean = uniqueName(sanitizeName(name, "New Folder"), others, "");
  if (clean === from) return from;
  renameSync(join(root, from), join(root, clean));
  const rewrite = (id: string): string => (id.startsWith(`${from}/`) ? `${clean}/${id.slice(from.length + 1)}` : id);
  updateSidecar(root, (sidecar) => {
    sidecar.pinned = sidecar.pinned.map(rewrite);
    for (const entry of Object.values(sidecar.trash)) entry.from = rewrite(entry.from);
  });
  return clean;
}
