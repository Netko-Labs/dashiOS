/**
 * What a document is called and where it goes: its name in the toolbar
 * ("notes.txt — Edited"), the folder under it with the home folder as `~`, and
 * the path a typed location in Open or Save As stands for.
 */

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

export const UNTITLED = "Untitled";

/** The document's name: its file's, or Untitled before it has one. */
export function displayName(path: string | null): string {
  return path === null ? UNTITLED : basename(path) || path;
}

/** The toolbar's title: the name, and "Edited" while there are changes not saved. */
export function editedTitle(path: string | null, dirty: boolean): string {
  const name = displayName(path);
  return dirty ? `${name} — Edited` : name;
}

/** `path` with the home folder written `~`. */
export function tildePath(path: string, home: string = homedir()): string {
  if (home === "" || home === "/") return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The folder a document is in, as the toolbar's subtitle shows it; null before it has a file. */
export function folderLabel(path: string | null, home: string = homedir()): string | null {
  return path === null ? null : tildePath(dirname(path), home);
}

/**
 * The absolute path a typed location stands for: `~` and `~/…` are the home
 * folder, a relative one is under `base`. Null when nothing (or a NUL) was typed.
 */
export function resolveInput(input: string, base: string, home: string = homedir()): string | null {
  const typed = input.trim();
  if (typed === "" || typed.includes("\0")) return null;
  const expanded = typed === "~" ? home : typed.startsWith("~/") ? join(home, typed.slice(2)) : typed;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

/** Where Save As starts: the file itself, or Untitled.txt in Documents (the home folder without one). */
export function suggestedSavePath(path: string | null, home: string = homedir(), hasDocuments = true): string {
  if (path !== null) return tildePath(path, home);
  return tildePath(join(hasDocuments ? join(home, "Documents") : home, `${UNTITLED}.txt`), home);
}
