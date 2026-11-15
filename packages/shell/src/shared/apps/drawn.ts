/**
 * Whether mirin's host draws a picture file as it is. Its engine (sumi) decodes
 * PNG, JPEG, GIF, WebP, BMP and ICO and draws SVG; anything else handed to an
 * `<Image>` (a TIFF, an XPM, a HEIC) is a blank with no word of why. So a
 * picture Dashi did not make (an app's icon by path, an account picture, an
 * applet's icon, bytes an app sent) is asked about first, and gets the generic
 * icon, a letter or a sentence instead.
 *
 * The first bytes decide. A name is believed only for SVG, which has no first
 * bytes of its own (a long comment or a DOCTYPE can come before `<svg`).
 * Preview's table (shared/files/kinds.ts, `native`) is the same rule; a test
 * holds the two together.
 */

import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";

/** The most of a file `hostDraws` reads. */
export const HEAD_BYTES = 4096;

const SVG_START = /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i;

/** What the first bytes say a file is, of the kinds that matter here: one the host draws, one it does not, or nothing known. */
function verdict(head: Uint8Array): "drawn" | "not" | "unknown" {
  const at = (index: number): number => head[index] ?? -1;
  const ascii = (from: number, text: string): boolean => [...text].every((char, index) => at(from + index) === char.charCodeAt(0));
  if (at(0) === 0x89 && ascii(1, "PNG\r\n")) return "drawn";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "drawn";
  if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "drawn";
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "drawn";
  if (ascii(0, "BM") && head.length >= 26) return "drawn";
  // An ICO: reserved 0, type 1 (an icon), at least one picture.
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0 && (at(4) > 0 || at(5) > 0)) return "drawn";
  if (SVG_START.test(new TextDecoder("utf-8", { fatal: false }).decode(head.subarray(0, 2048)))) return "drawn";
  const tiff = (ascii(0, "II") && at(2) === 42 && at(3) === 0) || (ascii(0, "MM") && at(2) === 0 && at(3) === 42);
  if (tiff || ascii(4, "ftyp") || ascii(0, "%PDF-") || ascii(0, "/* XPM */") || (at(0) === 0xff && at(1) === 0x0a) || ascii(0, "\0\0\0\fJXL ")) return "not";
  return "unknown";
}

/** Whether the host draws a picture that starts with these bytes. */
export const hostDraws = (head: Uint8Array): boolean => verdict(head) === "drawn";

/** By path: the answer for the file as it was (an account picture is rewritten in place). */
const known = new Map<string, { stamp: string; draws: boolean }>();

function stampOf(path: string): string | null {
  try {
    const stat = statSync(path);
    return stat.isFile() ? `${stat.mtimeMs}:${stat.size}` : null;
  } catch {
    return null;
  }
}

/** `hostDraws` for the file at `path`; its bytes are read once per change of the file (an icon is asked about at every draw). A file that cannot be read is not drawn. */
export function hostDrawsFile(path: string): boolean {
  const stamp = stampOf(path);
  if (stamp === null) return false;
  const before = known.get(path);
  if (before?.stamp === stamp) return before.draws;
  let fd: number | null = null;
  let draws = false;
  try {
    fd = openSync(path, "r");
    if (fstatSync(fd).isFile()) {
      const head = new Uint8Array(HEAD_BYTES);
      const said = verdict(head.subarray(0, readSync(fd, head, 0, HEAD_BYTES, 0)));
      draws = said === "drawn" || (said === "unknown" && /\.svgz?$/i.test(path));
    }
  } catch {
    // Unreadable: not drawn.
  } finally {
    if (fd !== null) closeSync(fd);
  }
  if (known.size > 2048) known.clear();
  known.set(path, { stamp, draws });
  return draws;
}
