/**
 * File and folder names for notes. A note's title becomes its file name, so
 * the title is untrusted text on its way to a path: it is cut down to one safe
 * path segment here, and every path the store touches is checked to be inside
 * the notes root (`inside`) before it is read, written, renamed, or removed.
 */

import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** The longest file name (without ".md") a title makes; ext4 allows 255 bytes, and UTF-8 titles take up to four per character. */
export const MAX_NAME_BYTES = 120;
/** What an empty title is called on disk. */
export const UNTITLED = "Untitled";
/** What an untitled note is called wherever its title shows: what its file is called. */
export const untitled = (title: string): string => (title.trim() === "" ? UNTITLED : title);

/** What the root folder is called in the sidebar (the notes that sit directly in the root). */
export const DEFAULT_FOLDER_NAME = "Notes";

const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const encoder = new TextEncoder();

/** `text` cut to at most `bytes` UTF-8 bytes, on a character boundary. */
export function clipBytes(text: string, bytes: number): string {
  let out = "";
  let used = 0;
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (used + size > bytes) break;
    out += char;
    used += size;
  }
  return out;
}

/**
 * One safe path segment from a title or folder name: no separators or
 * control characters, no leading dots (a hidden file, or "..") or trailing
 * dots and spaces, collapsed spaces, bounded length. Empty becomes `fallback`.
 */
export function sanitizeName(title: string, fallback: string = UNTITLED): string {
  const cleaned = title
    .normalize("NFC")
    .replace(FORBIDDEN, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+/, "")
    .trim();
  const clipped = clipBytes(cleaned, MAX_NAME_BYTES).replace(/[.\s]+$/, "");
  return clipped === "" ? fallback : clipped;
}

/** `base` if no one in `taken` has it (compared without case, so a synced copy on another system doesn't collide); else "base 2", "base 3", … */
export function uniqueName(base: string, taken: Iterable<string>, ext = ""): string {
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  if (!used.has(`${base}${ext}`.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${clipBytes(base, MAX_NAME_BYTES - suffix.length)}${suffix}`;
    if (!used.has(`${candidate}${ext}`.toLowerCase())) return candidate;
  }
}

/**
 * `rel` (a "/"-separated path from `root`) as an absolute path, or null when
 * it is not strictly inside `root`: absolute, with "..", empty segments,
 * or NUL. This is lexical; the store also refuses symlinks where it walks.
 */
export function inside(root: string, rel: string): string | null {
  if (rel === "" || rel.includes("\u0000") || isAbsolute(rel) || rel.includes("\\")) return null;
  if (rel.split("/").some((part) => part === "" || part === "." || part === "..")) return null;
  const full = resolve(root, ...rel.split("/"));
  const back = relative(resolve(root), full);
  return back !== "" && !back.startsWith("..") && !isAbsolute(back) ? full : null;
}

/** "Folder/Title.md" from the folder and the file name; the default folder is "". */
export const noteId = (folder: string, file: string): string => (folder === "" ? file : `${folder}/${file}`);

/** The folder and file name (with the extension) of a note id. */
export function splitId(id: string): { folder: string; file: string } {
  const slash = id.lastIndexOf("/");
  return slash < 0 ? { folder: "", file: id } : { folder: id.slice(0, slash), file: id.slice(slash + 1) };
}

/** Whether `id` has the shape of a note id: at most one folder, a ".md" file, nothing hidden. */
export function isNoteId(id: unknown): id is string {
  if (typeof id !== "string" || id.length > 600) return false;
  const parts = id.split("/");
  if (parts.length > 2 || parts.some((part) => part === "" || part.startsWith("."))) return false;
  return /\.md$/i.test(parts[parts.length - 1] ?? "") && inside("/r", id) !== null;
}

/** Where a path sits relative to a root, with "/" separators. */
export const toId = (root: string, full: string): string => relative(root, full).split(sep).join("/");

export const joinRoot = (root: string, ...parts: string[]): string => join(root, ...parts);
