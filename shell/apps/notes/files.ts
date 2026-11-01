/** The filesystem steps the store is built from: atomic writes, moves that never overwrite, and reads that refuse symlinks. */

import { closeSync, fsyncSync, linkSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** Larger files are not notes; they are left alone. */
export const MAX_NOTE_BYTES = 4 * 1024 * 1024;

/**
 * Writes `text` so no reader ever sees half of it: a temporary file in the
 * same folder (hidden, so nothing mistakes it for a note), flushed, then
 * renamed over the target.
 */
export function writeAtomic(path: string, text: string): void {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const fd = openSync(temp, "wx", 0o644);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } catch (error) {
    closeSync(fd);
    unlinkSync(temp);
    throw error;
  }
  closeSync(fd);
  try {
    renameSync(temp, path);
  } catch (error) {
    unlinkSync(temp);
    throw error;
  }
}

/** Creates `path` holding `text`, failing (EEXIST) if it exists; the file appears whole, by a link from a temporary one. */
export function writeNew(path: string, text: string): void {
  const temp = join(dirname(path), `.${basename(path)}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`);
  const fd = openSync(temp, "wx", 0o644);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    linkSync(temp, path);
  } finally {
    unlinkSync(temp);
  }
}

/** Moves `from` to `to`, failing (EEXIST) instead of replacing what is there. */
export function moveNoClobber(from: string, to: string): void {
  linkSync(from, to);
  unlinkSync(from);
}

/** Whether `path` is a regular file (a symlink is not: nothing is followed out of the notes folder). */
export function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

export function isRealDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}
