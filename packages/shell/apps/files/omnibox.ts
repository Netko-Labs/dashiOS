/**
 * The omnibox's rules: what typed text means, and the folders that complete
 * a typed path. Text that starts like a path (`/`, `~`, `file://`) goes
 * somewhere; anything else searches.
 */

import { readdirSync } from "node:fs";
import { expandHome } from "./paths.ts";

export type Intent = "path" | "search";

export function intentOf(text: string): Intent {
  const typed = text.trimStart();
  return typed.startsWith("/") || typed.startsWith("~") || typed.startsWith("file://") ? "path" : "search";
}

/** How a folder reads in the box: `~/Developer/dnd` under home, else the path itself. */
export function displayPath(path: string, home: string): string {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The subfolder names of `dir`; none when it can't be read. */
export function subfolders(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Up to `limit` folders that complete `text` (a path as typed, `~` kept):
 * the subfolders of its folder part whose names start with the last part,
 * any case, hidden ones only once the last part starts with a dot. Each
 * ends in `/`, ready for the next name.
 */
export function completions(text: string, home: string, list: (dir: string) => string[] = subfolders, limit = 8): string[] {
  const typed = text.trimStart();
  if (intentOf(typed) !== "path" || typed.startsWith("file://")) return [];
  const cut = typed.lastIndexOf("/");
  // "~" alone completes nothing yet; "~/" lists home.
  if (cut < 0) return [];
  const head = typed.slice(0, cut + 1);
  const part = typed.slice(cut + 1).toLowerCase();
  const dir = expandHome(head, home);
  return list(dir.length > 1 ? dir.replace(/\/+$/, "") || "/" : dir)
    .filter((name) => (part.startsWith(".") || !name.startsWith(".")) && name.toLowerCase().startsWith(part))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .slice(0, limit)
    .map((name) => `${head}${name}/`);
}
