/**
 * "Open With…": the apps that can open a file's type, from `gio mime`, and
 * starting one on the file (`gio launch`). Show in Files and Move to Trash
 * are `gio open` and `gio trash`. Every command is a structured argument list
 * with absolute paths; the desktop file a launch names is found by us in the
 * XDG data directories, never taken from the tool's text.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirs, parseDesktopEntry } from "../../src/entries.ts";
import { runTool } from "./tools.ts";

export interface Handler {
  /** `org.gnome.Loupe.desktop`. */
  id: string;
  name: string;
  /** The desktop file on disk. */
  file: string;
  isDefault: boolean;
}

const DESKTOP_ID = /^[A-Za-z0-9._-]{1,200}\.desktop$/;

/** The ids `gio mime <type>` listed: the default first, then the registered and recommended ones, each once. */
export function parseGioMime(stdout: string): string[] {
  const ids: string[] = [];
  const add = (id: string): void => {
    if (DESKTOP_ID.test(id) && !ids.includes(id)) ids.push(id);
  };
  const first = /^Default application for [^:\n]*:\s*(\S+)\s*$/m.exec(stdout)?.[1];
  if (first) add(first);
  for (const line of stdout.split("\n")) if (/^\s+\S+\.desktop\s*$/.test(line)) add(line.trim());
  return ids;
}

/** Where a desktop id lives: `a-b.desktop` may be `a/b.desktop` in a subfolder of an applications directory. */
export function findDesktopFile(id: string, dirs: readonly string[] = dataDirs(), exists: (path: string) => boolean = existsSync): string | null {
  if (!DESKTOP_ID.test(id)) return null;
  const nested = id.replaceAll("-", "/");
  for (const dir of dirs) {
    for (const name of [id, nested]) {
      const path = join(dir, "applications", name);
      if (exists(path)) return path;
    }
  }
  return null;
}

/** The apps for a MIME type, named, the default marked; `skip` leaves out an id (Preview itself). */
export async function handlersFor(mime: string, skip: readonly string[] = []): Promise<Handler[]> {
  if (!/^[a-z]+\/[a-z0-9.+-]+$/i.test(mime)) return [];
  const result = await runTool(["gio", "mime", mime], { timeoutMs: 5000 });
  if (!result.ok) return [];
  const ids = parseGioMime(result.stdout);
  const defaultId = /^Default application for [^:\n]*:\s*(\S+)\s*$/m.exec(result.stdout)?.[1];
  const handlers: Handler[] = [];
  for (const id of ids) {
    if (skip.includes(id)) continue;
    const file = findDesktopFile(id);
    if (!file) continue;
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const entry = parseDesktopEntry(id.replace(/\.desktop$/, ""), text);
    if (entry) handlers.push({ id, name: entry.name, file, isDefault: id === defaultId });
  }
  return handlers;
}

/** Open `path` with a handler. True when the launcher accepted it. */
export async function openWith(handler: Handler, path: string): Promise<boolean> {
  if (!path.startsWith("/")) return false;
  return (await runTool(["gio", "launch", handler.file, path], { timeoutMs: 10_000 })).ok;
}

/** Open the folder in the default file manager (`gio open`). */
export async function showInFiles(dir: string): Promise<boolean> {
  if (!dir.startsWith("/")) return false;
  return (await runTool(["gio", "open", dir], { timeoutMs: 10_000 })).ok;
}

/** Move a file to the Trash (`gio trash`). The error text when it failed, else null. */
export async function moveToTrash(path: string): Promise<string | null> {
  if (!path.startsWith("/")) return "Not an absolute path.";
  const result = await runTool(["gio", "trash", path], { timeoutMs: 15_000 });
  return result.ok ? null : result.stderr.replace(/^gio:\s*/, "").trim() || "The file could not be moved to the Trash.";
}
