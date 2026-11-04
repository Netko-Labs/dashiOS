/**
 * Reading and writing the document's file. Reading refuses what isn't a
 * regular file, what is too large to edit in Metal's text input, and what
 * isn't text (codec.ts). Writing goes to a temp file beside the target,
 * flushed and renamed over it, so a crash never leaves half a file; the temp
 * file takes the old file's permissions, and a symlink is written through to
 * its target. Where the folder can't take a temp file (the file is writable
 * but its folder is not), the file is overwritten in place.
 */

import { chmodSync, closeSync, fsyncSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Decoded, decodeText } from "./codec.ts";

/** Larger files are refused: the input lays out its whole text on every change. */
export const MAX_BYTES = 4 * 1024 * 1024;

export type ReadResult = { ok: true; decoded: Decoded } | { ok: false; message: string };

const reason = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ENOENT") return "There is no such file.";
  if (code === "EACCES" || code === "EPERM") return "You don't have permission to open it.";
  if (code === "EISDIR") return "It is a folder.";
  return error instanceof Error ? error.message : String(error);
};

export function readDocument(path: string): ReadResult {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) return { ok: false, message: "It is a folder." };
    if (!stat.isFile()) return { ok: false, message: "It isn't a regular file." };
    if (stat.size > MAX_BYTES) return { ok: false, message: `It is larger than ${MAX_BYTES / 1024 / 1024} MB, too large to edit here.` };
    const decoded = decodeText(new Uint8Array(readFileSync(path)));
    return decoded ? { ok: true, decoded } : { ok: false, message: "It doesn't look like a text file." };
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}

function writeAll(fd: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
}

let counter = 0;

/** Writes `bytes` to `path`; the reason it could not, or null. */
export function writeDocument(path: string, bytes: Uint8Array): string | null {
  let target = path;
  let mode = 0o644;
  try {
    target = realpathSync(path);
    mode = statSync(target).mode & 0o7777;
  } catch {
    // A new file.
  }
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}.${++counter}.tmp`);
  try {
    const fd = openSync(temp, "wx", 0o600);
    try {
      writeAll(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temp, mode);
    renameSync(temp, target);
    return null;
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Never made.
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return "That folder doesn't exist.";
    if (code !== "EACCES" && code !== "EPERM" && code !== "EROFS") return reason(error);
  }
  try {
    const fd = openSync(target, "w", mode);
    try {
      writeAll(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    return null;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return code === "EACCES" || code === "EPERM" ? "You don't have permission to save it there." : code === "EROFS" ? "That disk is read-only." : reason(error);
  }
}
