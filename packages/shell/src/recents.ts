/**
 * The apps opened from the launcher, most recent first, so an empty launcher
 * can offer them. Remembered as a list of app ids in
 * `$XDG_STATE_HOME/dashi/recents.json`: this is history, not a setting, so
 * it lives with the state and not in settings.json. A missing or damaged file
 * is an empty history; a failed write is logged and the history lives on in
 * memory for the session.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Entry } from "./entries.ts";

/** How many apps the history keeps; the launcher shows up to `SHOWN`. */
export const MAX_RECENTS = 12;
export const SHOWN = 6;
const MAX_ID_LENGTH = 256;

export function recentsPath(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "recents.json");
}

const isAppId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH && !/[\u0000-\u001f\u007f]/.test(value);

/** The ids in a saved file, or [] when it is not one of ours. A repeated id counts at its first place. */
export function parseRecents(text: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const { recent } = value as Record<string, unknown>;
  if (!Array.isArray(recent)) return [];
  return [...new Set(recent.filter(isAppId))].slice(0, MAX_RECENTS);
}

/** `ids` with `id` brought to the front. */
export function remember(ids: readonly string[], id: string): string[] {
  return [id, ...ids.filter((other) => other !== id)].slice(0, MAX_RECENTS);
}

/** The installed apps among `ids`, in that order; ids that are not installed here are skipped. */
export function recentEntries(entries: readonly Entry[], ids: readonly string[], limit = SHOWN): Entry[] {
  const byId = new Map<string, Entry>();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  return ids.flatMap((id) => byId.get(id) ?? []).slice(0, limit);
}

export function loadRecents(path: string = recentsPath()): string[] {
  try {
    return parseRecents(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}

/** Put `id` first in the saved history and return the new history. */
export function rememberLaunch(id: string, path: string = recentsPath()): string[] {
  const next = remember(loadRecents(path), id);
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, recent: next }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    console.error("dashi-shell: could not save the recent apps:", error instanceof Error ? error.message : error);
  }
  return next;
}

/**
 * The history held in memory for the shell's life: read from disk once, at
 * the first ask, and written back (off the launcher's path) after each
 * launch. A ❖ tap reads only memory.
 */
export class RecentApps {
  private ids: string[] | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string = recentsPath(),
    private readonly save: (path: string, ids: readonly string[]) => Promise<void> = saveRecents,
  ) {}

  /** The ids, most recent first. */
  list(): readonly string[] {
    this.ids ??= loadRecents(this.path);
    return this.ids;
  }

  /** Put `id` first; the file follows, one write after another. */
  remember(id: string): readonly string[] {
    const next = remember(this.list(), id);
    this.ids = next;
    this.writing = this.writing.then(() => this.save(this.path, next));
    return next;
  }

  /** Take `id` out (an app that quit as soon as it started is not one to offer again); the file follows. */
  forget(id: string): readonly string[] {
    const next = this.list().filter((other) => other !== id);
    if (next.length === this.list().length) return next;
    this.ids = next;
    this.writing = this.writing.then(() => this.save(this.path, next));
    return next;
  }

  /** Resolves when every write asked for so far is done (tests, shutdown). */
  settled(): Promise<void> {
    return this.writing;
  }
}

/** Write `ids` to `path` atomically (a temp file, then a rename), 0600; a failure is logged. */
export async function saveRecents(path: string, ids: readonly string[]): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify({ version: 1, recent: ids }, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    console.error("dashi-shell: could not save the recent apps:", error instanceof Error ? error.message : error);
  }
}
