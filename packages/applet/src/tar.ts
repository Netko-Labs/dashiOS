/**
 * The tar inside a .dashi-applet: plain ustar, written the same way every
 * time (sorted names, mode 0644, owner 0, time 0) so that the same files make
 * the same bytes, and the catalog's CI can rebuild a package from its source
 * and compare. Reading takes regular files only: a link, a device, an
 * absolute path, or `..` refuses the whole archive.
 */

import { isInsidePath } from "@dashi/shape/kit";

const BLOCK = 512;

function octal(value: number, width: number): string {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function header(name: string, size: number): Uint8Array {
  const block = new Uint8Array(BLOCK);
  const put = (text: string, at: number): void => block.set(new TextEncoder().encode(text), at);
  const bytes = new TextEncoder().encode(name);
  // ustar's name is 100 bytes, with a 155-byte prefix for longer paths split at a slash.
  let prefix = "";
  let short = name;
  if (bytes.byteLength > 100) {
    const cut = name.lastIndexOf("/", 155);
    if (cut <= 0 || new TextEncoder().encode(name.slice(cut + 1)).byteLength > 100) throw new Error(`a path is too long for the package: ${name}`);
    prefix = name.slice(0, cut);
    short = name.slice(cut + 1);
  }
  put(short, 0);
  put(octal(0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(0, 12), 136);
  put("        ", 148);
  put("0", 156);
  put("ustar\0", 257);
  put("00", 263);
  put(prefix, 345);
  const sum = block.reduce((total, byte) => total + byte, 0);
  put(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return block;
}

/** A gzipped tar of `files` (path → bytes), byte for byte the same for the same files. */
export function writeTar(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const name of [...files.keys()].sort()) {
    if (!isInsidePath(name)) throw new Error(`not a path inside the package: ${name}`);
    const data = files.get(name) ?? new Uint8Array();
    parts.push(header(name, data.byteLength), data);
    const pad = (BLOCK - (data.byteLength % BLOCK)) % BLOCK;
    if (pad > 0) parts.push(new Uint8Array(pad));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const tar = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    tar.set(part, at);
    at += part.byteLength;
  }
  return Bun.gzipSync(tar, { level: 9 });
}

const field = (block: Uint8Array, at: number, length: number): string => new TextDecoder().decode(block.subarray(at, at + length)).replace(/\0.*$/s, "");

export interface ReadLimits {
  files: number;
  /** Bytes of every file together, unpacked. */
  bytes: number;
}

/** The files in a gzipped tar, or why it is refused. */
export function readTar(gzipped: Uint8Array, limits: ReadLimits = { files: 512, bytes: 64 * 1024 * 1024 }): Map<string, Uint8Array> | { error: string } {
  let tar: Uint8Array;
  try {
    tar = Bun.gunzipSync(new Uint8Array(gzipped));
  } catch {
    return { error: "the package is not a gzipped tar" };
  }
  const files = new Map<string, Uint8Array>();
  let total = 0;
  let at = 0;
  while (at + BLOCK <= tar.byteLength) {
    const block = tar.subarray(at, at + BLOCK);
    if (block.every((byte) => byte === 0)) break;
    const type = field(block, 156, 1) || "0";
    const prefix = field(block, 345, 155);
    const name = prefix ? `${prefix}/${field(block, 0, 100)}` : field(block, 0, 100);
    const size = Number.parseInt(field(block, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) return { error: "the package has a broken entry" };
    at += BLOCK;
    if (type === "5") {
      at += Math.ceil(size / BLOCK) * BLOCK;
      continue;
    }
    if (type !== "0") return { error: `the package holds something that is not a file: ${name}` };
    if (!isInsidePath(name)) return { error: `the package has a path outside itself: ${name}` };
    if (files.has(name)) return { error: `the package has ${name} twice` };
    total += size;
    if (files.size + 1 > limits.files || total > limits.bytes) return { error: "the package is too large" };
    if (at + size > tar.byteLength) return { error: "the package is cut short" };
    files.set(name, tar.slice(at, at + size));
    at += Math.ceil(size / BLOCK) * BLOCK;
  }
  return files;
}
