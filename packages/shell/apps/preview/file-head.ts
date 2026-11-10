/**
 * A file's head, read before anything is opened: its stat (the stamp the
 * cache and the remembered rotations are keyed by) and the first bytes that
 * say what kind of file it is; or the message that says why it can't be opened.
 */

import { stat } from "node:fs/promises";
import type { Stamp } from "./cache.ts";
import { HEADER_BYTES } from "./dimensions.ts";
import { MESSAGES } from "./messages.ts";

/** Files over this are not opened at all. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export type FileHead = { ok: true; stamp: Stamp; head: Uint8Array } | { ok: false; message: string };

export async function readFileHead(path: string): Promise<FileHead> {
  let stamp: Stamp;
  try {
    const info = await stat(path);
    if (!info.isFile()) return { ok: false, message: MESSAGES.notAFile };
    if (info.size > MAX_FILE_BYTES) return { ok: false, message: MESSAGES.tooLarge };
    stamp = { path, mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return { ok: false, message: MESSAGES.notFound };
  }
  try {
    return { ok: true, stamp, head: new Uint8Array(await Bun.file(path).slice(0, HEADER_BYTES).arrayBuffer()) };
  } catch {
    return { ok: false, message: MESSAGES.unreadable };
  }
}
