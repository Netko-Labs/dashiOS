/**
 * Trash: moving to it (`gio trash`, which follows the Trash specification
 * including per-disk trash folders), listing what is in the home Trash with
 * where each item came from, putting back, deleting for good, and emptying.
 * Deleting for good only ever touches a direct child of the Trash's `files`
 * folder, checked on the resolved path.
 */

import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { type Exec, exec } from "./exec.ts";
import { type FileItem, itemAt } from "./items.ts";
import type { MimeIndex } from "./mime.ts";
import { Cancelled, moveInto, type OpContext, OpError, quietContext } from "./ops.ts";
import { baseName, isInside, normalizePath, parentOf } from "./paths.ts";
import { parseTrashInfo } from "./trash.ts";

export interface TrashPlaces {
  files: string;
  info: string;
}

/** Paths that are never trashed from here: the root, the home folder, and the folders the sidebar lists. */
export function protectedReason(path: string, home: string, userDirs: readonly string[]): string | null {
  const clean = normalizePath(path);
  if (clean === null) return "That isn’t a valid path.";
  if (clean === "/" || clean === home) return "The home folder and the root folder can’t be moved to the Trash.";
  if (userDirs.includes(clean)) return `“${baseName(clean)}” is one of your standard folders and can’t be moved to the Trash.`;
  // /usr, /etc, and their kin belong to the system.
  if (parentOf(clean) === "/") return `“${baseName(clean)}” is a system folder and can’t be moved to the Trash.`;
  return null;
}

export interface TrashResult {
  trashed: string[];
  failed: Array<{ path: string; reason: string }>;
}

/** Moves each path to the Trash with `gio trash`, one program run per path so one failure doesn't hide the rest. */
export async function trashPaths(paths: readonly string[], ctx: OpContext, run: Exec = exec): Promise<TrashResult> {
  const result: TrashResult = { trashed: [], failed: [] };
  for (const path of paths) {
    if (ctx.signal.aborted) throw new Cancelled();
    const clean = normalizePath(path);
    if (clean === null) {
      result.failed.push({ path, reason: "That isn’t a valid path." });
      continue;
    }
    // `--` so a name that starts with a dash is a name.
    const outcome = await run(["gio", "trash", "--", clean], { signal: ctx.signal });
    if (outcome.ok) result.trashed.push(clean);
    else result.failed.push({ path: clean, reason: outcome.stderr.replace(/^gio: /, "").trim() || "It couldn’t be moved to the Trash." });
    ctx.advance(1);
  }
  return result;
}

/** What is in the home Trash, newest first, with each item's origin. Items whose info file is missing are still listed. */
export async function listTrash(places: TrashPlaces, index: MimeIndex): Promise<FileItem[]> {
  let names: string[];
  try {
    names = await readdir(places.files);
  } catch {
    return [];
  }
  const items = await Promise.all(
    names.map(async (name): Promise<FileItem | null> => {
      const item = await itemAt(join(places.files, name), index);
      if (!item) return null;
      const info = await readFile(join(places.info, `${name}.trashinfo`), "utf8").then(parseTrashInfo, () => null);
      return { ...item, ...(info ? { original: info.originalPath, ...(info.deletedAt !== null ? { deleted: info.deletedAt } : {}) } : {}) };
    }),
  );
  return items.filter((item): item is FileItem => item !== null).sort((a, b) => (b.deleted ?? 0) - (a.deleted ?? 0));
}

/** The item's name in the Trash if `path` is a direct child of its `files` folder. */
function trashedName(path: string, places: TrashPlaces): string {
  const clean = normalizePath(path);
  if (clean === null || parentOf(clean) !== places.files || !isInside(places.files, clean)) throw new OpError("That isn’t in the Trash.");
  return baseName(clean);
}

/** Removes a trashed item and its info file for good. */
export async function deleteForever(path: string, places: TrashPlaces): Promise<void> {
  const name = trashedName(path, places);
  await rm(join(places.files, name), { recursive: true, force: true });
  await rm(join(places.info, `${name}.trashinfo`), { force: true });
}

/** Puts a trashed item back where it came from (under a free name if that is taken); the new path. */
export async function putBack(path: string, places: TrashPlaces, home: string): Promise<string> {
  const name = trashedName(path, places);
  const info = await readFile(join(places.info, `${name}.trashinfo`), "utf8").then(parseTrashInfo, () => null);
  if (!info) throw new OpError("Its original location isn’t known.");
  const back = parentOf(info.originalPath);
  // Folders it was in are made again under the home folder; elsewhere the folder has to be there.
  if (isInside(home, back)) await mkdir(back, { recursive: true });
  else if (
    !(await stat(back).then(
      (info) => info.isDirectory(),
      () => false,
    ))
  )
    throw new OpError("The folder it came from is gone.");
  const restored = await moveInto(join(places.files, name), back, quietContext(), baseName(info.originalPath));
  if (restored === null) throw new OpError("It couldn’t be put back.");
  await rm(join(places.info, `${name}.trashinfo`), { force: true });
  return restored;
}

/** Empties the home Trash by hand: everything in `files`, and every record in `info`. Only ever those two folders. */
export async function emptyHomeTrash(places: TrashPlaces): Promise<void> {
  for (const dir of [places.files, places.info]) {
    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    // `rm` removes a link itself, never what it points at.
    for (const name of names) await rm(join(dir, name), { recursive: true, force: true });
  }
}

/**
 * Empties every Trash (`gio trash --empty` also reaches the Trash folders of
 * other disks). Without GVfs running (no session bus) gio can't, and the home
 * Trash is emptied directly.
 */
export async function emptyTrash(places: TrashPlaces, run: Exec = exec): Promise<void> {
  const outcome = await run(["gio", "trash", "--empty"]);
  if (outcome.ok) return;
  await emptyHomeTrash(places);
}
