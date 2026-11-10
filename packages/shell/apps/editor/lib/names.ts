/**
 * What a document is called and where it goes: its name in the toolbar
 * ("notes.txt"), its folder after it with the home folder as `~`, and
 * the path a typed location in Open or Save As stands for.
 */

import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { freeName } from "../../../src/shared/files/chooser/filters.ts";

export const UNTITLED = "Untitled";

/** The document's name: its file's, or Untitled before it has one. */
export function displayName(path: string | null): string {
  return path === null ? UNTITLED : basename(path) || path;
}

/** `path` with the home folder written `~`. */
export function tildePath(path: string, home: string = homedir()): string {
  if (home === "" || home === "/") return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The folder a document is in, as the muted words after the title show it; null before it has a file. */
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

/**
 * Where Save As starts: the file itself, or Untitled.txt in Documents (the home folder without one),
 * "Untitled 2.txt" and on where that is `taken`.
 */
export function suggestedSavePath(path: string | null, home: string = homedir(), hasDocuments = true, taken: (path: string) => boolean = () => false): string {
  if (path !== null) return tildePath(path, home);
  const folder = hasDocuments ? join(home, "Documents") : home;
  return tildePath(
    join(
      folder,
      freeName(`${UNTITLED}.txt`, (name) => taken(join(folder, name))),
    ),
    home,
  );
}
