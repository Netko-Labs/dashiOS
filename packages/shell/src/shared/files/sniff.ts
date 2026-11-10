/**
 * Typing a file by what is in it, when its name says nothing (IC-2): a log
 * called `install.err` or `build.done` is text, though no extension says
 * so. Only the first 512 bytes are read, and only for names the MIME
 * database doesn't know.
 */

import { constants } from "node:fs";
import { open } from "node:fs/promises";

export const SNIFF_BYTES = 512;
/** Past this many unknown names in one folder the rest stay unknown: a folder of thousands still lists at once. */
export const SNIFF_LIMIT = 256;

/** Whether `bytes` read as text: UTF-8 with no NUL and hardly any control characters besides tabs and line ends. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  if (bytes.includes(0)) return false;
  // A multi-byte character cut at the end of the sample is not a reason to say no.
  let end = bytes.length;
  for (let back = 1; back <= 3 && back <= bytes.length; back++) {
    const byte = bytes[bytes.length - back] as number;
    if ((byte & 0xc0) === 0xc0) {
      end = bytes.length - back;
      break;
    }
    if ((byte & 0x80) === 0) break;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, end));
  } catch {
    return false;
  }
  let control = 0;
  for (const byte of bytes) if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d && byte !== 0x0c && byte !== 0x1b) control++;
  return control * 20 <= bytes.length;
}

/** The type the first bytes of `path` show: `text/plain` for text, else null. */
export async function sniffType(path: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Non-blocking: a pipe that took a file's place since the listing never holds the window up.
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const buffer = new Uint8Array(SNIFF_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, SNIFF_BYTES, 0);
    return looksLikeText(buffer.subarray(0, bytesRead)) ? "text/plain" : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}
