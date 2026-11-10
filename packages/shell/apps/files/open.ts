/**
 * Opening files with the desktop's default apps (`gio open`) or a chosen one
 * (Open With, from the apps GIO lists for the file's type). The path is an
 * argument, never part of a shell string. `.desktop` files and executables
 * are not opened from here: opening a launcher or a program is running it,
 * and that isn't what a click in a file manager should do.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDirs, desktopFields, entryIcon } from "../../src/entries.ts";
import { resolvePinned } from "../../src/shared/apps/index.ts";
import { type Exec, exec } from "./exec.ts";
import { normalizePath } from "./paths.ts";
import { fileUri } from "./uri.ts";

export interface OpenCheck {
  ok: boolean;
  reason?: string;
}

/** Types that are programs or launchers: opening one runs it. */
const PROGRAMS = new Set([
  "application/x-executable",
  "application/x-pie-executable",
  "application/vnd.appimage",
  "application/x-sharedlib",
  "application/x-desktop",
  "application/x-ms-dos-executable",
  "application/x-msi",
  "application/x-flatpak-ref",
]);

/** Whether Files opens an item: a folder always; a file unless it is a launcher or program. */
export function mayOpen(item: { kind: string; name: string; mime: string }): OpenCheck {
  if (item.kind === "folder") return { ok: true };
  if (item.kind !== "file") return { ok: false, reason: "That kind of item can’t be opened." };
  if (/\.(desktop|appimage)$/i.test(item.name) || PROGRAMS.has(item.mime))
    return { ok: false, reason: "Programs and launchers aren’t run from Files. Start it from the launcher or a terminal." };
  return { ok: true };
}

/** How long `gio open` may take to hand a file to its app (a cold app started over D-Bus is the slow case). */
export const OPEN_TIMEOUT_MS = 10_000;

/** What became of an open: the app has it, it failed (and why), or the app hasn't taken it yet after `OPEN_TIMEOUT_MS`. */
export type OpenOutcome = { kind: "opened" } | { kind: "failed"; problem: string } | { kind: "waiting" };

/**
 * Hands a file or folder to its default app. `gio open` exits once the app
 * has it, while the app runs on holding gio's pipes: so it is waited for
 * until it exits (`untilExit`), not until the pipes close, which is when the
 * app quits.
 */
export async function openDefault(path: string, run: Exec = exec): Promise<OpenOutcome> {
  const clean = normalizePath(path);
  if (clean === null) return { kind: "failed", problem: "That isn’t a valid path." };
  const outcome = await run(["gio", "open", "--", clean], { untilExit: true, timeoutMs: OPEN_TIMEOUT_MS });
  if (outcome.timedOut) return { kind: "waiting" };
  return outcome.ok ? { kind: "opened" } : { kind: "failed", problem: outcome.stderr.replace(/^gio: /, "").trim() || "No app could open it." };
}

/** `openDefault` for a click: what went wrong, or null (an app still starting isn't wrong). */
export async function openWithDefault(path: string, run: Exec = exec): Promise<string | null> {
  const outcome = await openDefault(path, run);
  return outcome.kind === "failed" ? outcome.problem : null;
}

export interface OpenWithApp {
  /** `org.gnome.TextEditor.desktop` */
  id: string;
  name: string;
  /** The desktop entry's file. */
  file: string;
  /** Its icon, as the Dock and the launcher draw it (`entryIcon`). */
  icon: string;
}

/** The `.desktop` ids in `gio mime` output ("Registered applications:" and "Recommended applications:" lists), each once, recommended first. */
export function parseGioMime(output: string): string[] {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of output.split("\n")) {
    if (/^Recommended applications:/.test(line)) sections.set("recommended", (current = []));
    else if (/^Registered applications:/.test(line)) sections.set("registered", (current = []));
    else if (/^\s+\S+\.desktop\s*$/.test(line)) current?.push(line.trim());
    else if (line.trim() !== "") current = null;
  }
  const ids = [...(sections.get("recommended") ?? []), ...(sections.get("registered") ?? [])];
  return [...new Set(ids)].filter((id) => /^[\w.+-]+\.desktop$/.test(id));
}

async function findDesktopFile(id: string, dirs: readonly string[]): Promise<{ file: string; text: string } | null> {
  for (const dir of dirs) {
    const file = join(dir, "applications", id);
    try {
      return { file, text: await readFile(file, "utf8") };
    } catch {
      // Not in this directory.
    }
  }
  return null;
}

/** The apps that can open `mime`, named from their desktop entries. */
export async function appsFor(mime: string, run: Exec = exec, dirs: readonly string[] = dataDirs()): Promise<OpenWithApp[]> {
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return [];
  const outcome = await run(["gio", "mime", mime]);
  if (!outcome.ok) return [];
  const apps: OpenWithApp[] = [];
  const pinned = resolvePinned();
  for (const id of parseGioMime(outcome.stdout).slice(0, 40)) {
    const found = await findDesktopFile(id, dirs);
    if (!found) continue;
    const fields = desktopFields(found.text);
    if (fields.get("NoDisplay")?.toLowerCase() === "true" || fields.get("Hidden")?.toLowerCase() === "true") continue;
    const bare = id.replace(/\.desktop$/, "");
    apps.push({ id, name: fields.get("Name") ?? bare, file: found.file, icon: entryIcon(bare, fields.get("Icon") ?? "", pinned) });
  }
  return apps;
}

/** Opens `path` in the app whose desktop entry is `app.file` (`gio launch`). */
export async function openWith(app: Pick<OpenWithApp, "file">, path: string, run: Exec = exec): Promise<string | null> {
  const clean = normalizePath(path);
  if (clean === null || !app.file.startsWith("/") || !app.file.endsWith(".desktop")) return "That isn’t a valid request.";
  // As `openDefault`: gio is done when it exits; the app it started holds its pipes on.
  const outcome = await run(["gio", "launch", app.file, fileUri(clean)], { untilExit: true, timeoutMs: OPEN_TIMEOUT_MS });
  if (outcome.timedOut) return null;
  return outcome.ok ? null : outcome.stderr.replace(/^gio: /, "").trim() || "The app couldn’t open it.";
}
