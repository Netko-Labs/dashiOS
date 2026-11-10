/**
 * How Files shows a folder, kept across windows in
 * `$XDG_CONFIG_HOME/dashi/files.json`: icons or a list, the sort and its
 * direction, and whether hidden files show. Read when a window opens,
 * written when one of them changes. A chooser reads them too, and writes
 * nothing.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SortState } from "@dashi/ui";
import { writeTextAtomic } from "../../../src/shared/fs/atomic.ts";

export interface FilesPrefs {
  view: "icons" | "list";
  sort: SortState;
  showHidden: boolean;
}

export const SORT_KEYS = ["name", "modified", "size", "kind"] as const;
export const DEFAULT_PREFS: FilesPrefs = { view: "icons", sort: { key: "name", ascending: true }, showHidden: false };

export function prefsPath(env: Record<string, string | undefined> = process.env): string {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(config, "dashi", "files.json");
}

/** The settings in a file's text; the defaults for anything missing or wrong. */
export function parsePrefs(text: string): FilesPrefs {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_PREFS;
  const record = value as Record<string, unknown>;
  const sort = typeof record.sort === "object" && record.sort !== null ? (record.sort as Record<string, unknown>) : {};
  const key = SORT_KEYS.find((each) => each === sort.key);
  return {
    view: record.view === "list" ? "list" : "icons",
    sort: key ? { key, ascending: sort.ascending !== false } : DEFAULT_PREFS.sort,
    showHidden: record.showHidden === true,
  };
}

export function readPrefs(path: string = prefsPath()): FilesPrefs {
  try {
    return parsePrefs(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: FilesPrefs, path: string = prefsPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeTextAtomic(path, `${JSON.stringify(prefs, null, 2)}\n`);
  } catch {
    // Not kept this time; the window still shows what was chosen.
  }
}
