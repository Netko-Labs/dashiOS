/**
 * Thumbnails from the freedesktop cache (Thumbnail Managing Standard):
 * `~/.cache/thumbnails/<size>/<md5 of the file's URI>.png`. File managers,
 * image viewers, and the portals write them; Files only reads. A thumbnail is
 * used only when the file still has the modification time it recorded, so an
 * edited image never shows its old picture.
 */

import { existsSync, openSync, readSync, closeSync } from "node:fs";
import { join } from "node:path";
import { fileUri } from "./uri.ts";

export type ThumbSize = "normal" | "large" | "x-large" | "xx-large";

/** The cache's file name for a path: the MD5 of its `file://` URI, in hex, plus `.png`. */
export function thumbName(path: string): string {
  return `${new Bun.CryptoHasher("md5").update(fileUri(path)).digest("hex")}.png`;
}

/** Sizes to try for a tile of `pixels`, the first big enough first. */
export function sizesFor(pixels: number): ThumbSize[] {
  const all: Array<[ThumbSize, number]> = [["normal", 128], ["large", 256], ["x-large", 512], ["xx-large", 1024]];
  const enough = all.filter(([, size]) => size >= pixels).map(([name]) => name);
  const smaller = all.filter(([, size]) => size < pixels).map(([name]) => name).reverse();
  return [...enough, ...smaller];
}

/** The `Thumb::MTime` recorded in a PNG's text chunks, or null. Reads chunks up to the first image data. */
export function thumbMtime(png: Uint8Array): number | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.length < 8 || signature.some((byte, index) => png[index] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  while (at + 8 <= png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "IDAT" || type === "IEND") return null;
    if (type === "tEXt" && at + 8 + length <= png.length) {
      const body = png.subarray(at + 8, at + 8 + length);
      const zero = body.indexOf(0);
      if (zero > 0 && new TextDecoder().decode(body.subarray(0, zero)) === "Thumb::MTime") {
        const value = Number(new TextDecoder().decode(body.subarray(zero + 1)));
        return Number.isFinite(value) ? value : null;
      }
    }
    at += 12 + length;
  }
  return null;
}

/** The first bytes of a file (the text chunks come before the image). */
function head(path: string, bytes = 4096): Uint8Array | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = new Uint8Array(bytes);
    const read = readSync(fd, buffer, 0, bytes, 0);
    return buffer.subarray(0, read);
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** The cached thumbnail for `path` (modified at `mtimeMs`) of about `pixels`, or null. */
export function findThumbnail(path: string, mtimeMs: number, pixels: number, cacheDir: string, read: (file: string) => Uint8Array | null = head): string | null {
  const name = thumbName(path);
  const seconds = Math.floor(mtimeMs / 1000);
  for (const size of sizesFor(pixels)) {
    const file = join(cacheDir, "thumbnails", size, name);
    if (!existsSync(file)) continue;
    const recorded = thumbMtime(read(file) ?? new Uint8Array());
    // A thumbnail with no recorded time is trusted: some writers leave it out.
    if (recorded === null || recorded === seconds) return file;
  }
  return null;
}
