/**
 * A name collision (PA-3): what is coming in and what is there, as the
 * sheet shows them, and the answer it gets.
 */

import { lstat } from "node:fs/promises";
import { INODE_DIRECTORY, type MimeIndex, mimeOf } from "../../../../src/shared/files/mime.ts";
import { baseName } from "../../../../src/shared/files/paths.ts";

/** What a name collision is answered with (PA-3). */
export type Resolution = "replace" | "keep-both" | "skip";

/** One side of a collision, as the sheet shows it. */
export interface Side {
  path: string;
  folder: boolean;
  mime: string;
  size: number;
  mtime: number;
}

export interface Conflict {
  mode: "copy" | "move";
  /** What is coming in. */
  incoming: Side;
  /** What is there now, under the same name. */
  existing: Side;
  /** The folder it is going into. */
  dest: string;
  /** How many items are still to go after this one (for "Apply to all"). */
  remaining: number;
}

/** The person's answer: what to do, and whether for the rest of this copy or move too. */
export interface Answer {
  resolution: Resolution;
  all: boolean;
}

export async function sideOf(path: string, index: MimeIndex): Promise<Side | null> {
  try {
    const info = await lstat(path);
    const folder = info.isDirectory();
    return { path, folder, mime: folder ? INODE_DIRECTORY : mimeOf(index, baseName(path)), size: info.size, mtime: info.mtimeMs };
  } catch {
    return null;
  }
}
