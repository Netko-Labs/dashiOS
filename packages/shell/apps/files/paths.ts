/**
 * Paths and names, the part of Files that decides what may be written where.
 * Everything here is pure: names are checked before a path is joined, a
 * collision becomes "name 2", and "inside" is decided on resolved paths so
 * `..` can't climb out. A name from the person, a clipboard, or an agent is
 * untrusted until `checkName` says otherwise.
 */

import { posix } from "node:path";

/** Linux file names are at most 255 bytes. */
export const MAX_NAME_BYTES = 255;

/** Why `name` can't be a file's name, or null when it can. */
export function checkName(name: string): string | null {
  if (name === "") return "The name can’t be empty.";
  if (name === "." || name === "..") return `“${name}” can’t be used as a name.`;
  if (name.includes("/")) return "The name can’t contain a slash (/).";
  if (name.includes("\0")) return "The name can’t contain a null character.";
  // Line breaks and other control characters would break URIs, logs, and listings.
  if (/[\u0001-\u001f\u007f]/.test(name)) return "The name can’t contain control characters.";
  if (new TextEncoder().encode(name).length > MAX_NAME_BYTES) return `The name is too long (at most ${MAX_NAME_BYTES} bytes).`;
  return null;
}

/** An absolute, normalized path (`..` and `//` resolved), or null for anything else, including NUL. */
export function normalizePath(path: string): string | null {
  if (!path.startsWith("/") || path.includes("\0")) return null;
  return posix.normalize(path).replace(/(.)\/$/, "$1");
}

/** `name` inside `dir`, or null when the name is not a plain file name. */
export function joinName(dir: string, name: string): string | null {
  if (checkName(name) !== null) return null;
  const base = normalizePath(dir);
  return base === null ? null : posix.join(base, name);
}

/** Whether `path` is `parent` or lies below it (decided on normalized paths). */
export function isInside(parent: string, path: string): boolean {
  const a = normalizePath(parent);
  const b = normalizePath(path);
  if (a === null || b === null) return false;
  return a === "/" || b === a || b.startsWith(`${a}/`);
}

export function parentOf(path: string): string {
  return posix.dirname(normalizePath(path) ?? "/");
}

export function baseName(path: string): string {
  return path === "/" ? "/" : posix.basename(path);
}

const DOUBLE_EXTENSIONS = /\.(tar\.(gz|bz2|xz|zst|lz|lzma|z))$/i;

/** A name split into stem and extension (`archive.tar.gz`: `archive`, `.tar.gz`; `.bashrc`: no extension). */
export function splitName(name: string): { stem: string; ext: string } {
  const double = DOUBLE_EXTENSIONS.exec(name);
  if (double && double.index > 0) return { stem: name.slice(0, double.index), ext: name.slice(double.index) };
  const dot = name.lastIndexOf(".");
  // A leading dot is a hidden file, not an extension; a trailing dot has none either.
  if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: "" };
  return { stem: name.slice(0, dot), ext: name.slice(dot) };
}

/**
 * `name` if `taken` doesn't have it, else "name 2", "name 3", … with the
 * number before the extension ("report 2.txt"). Gives up after a few
 * thousand tries, which only a hostile folder reaches.
 */
export function uniqueName(name: string, taken: (candidate: string) => boolean): string {
  if (!taken(name)) return name;
  const { stem, ext } = splitName(name);
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!taken(candidate)) return candidate;
  }
  return `${stem} ${crypto.randomUUID().slice(0, 8)}${ext}`;
}

/** The name a duplicate gets before collisions are resolved: "report copy.txt". */
export function copyName(name: string): string {
  const { stem, ext } = splitName(name);
  return `${stem} copy${ext}`;
}

export interface Crumb {
  name: string;
  path: string;
}

/**
 * The path bar's segments: from the home folder when `path` is inside it
 * (the first crumb is the home folder, named "Home"), else from the root.
 */
export function crumbs(path: string, home: string): Crumb[] {
  const clean = normalizePath(path) ?? "/";
  const root = isInside(home, clean) && home !== "/" ? (normalizePath(home) as string) : "/";
  const first: Crumb = { name: root === "/" ? "/" : "Home", path: root };
  const rest = clean === root ? [] : clean.slice(root === "/" ? 1 : root.length + 1).split("/");
  let at = root;
  return [first, ...rest.map((segment) => ({ name: segment, path: (at = posix.join(at, segment)) }))];
}

/** `~/Documents` for a path in the home folder, else the path. */
export function tilde(path: string, home: string): string {
  if (path === home) return "~";
  return home !== "/" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Expands a leading `~`; relative paths are not paths here. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  return path.startsWith("~/") ? posix.join(home, path.slice(2)) : path;
}
