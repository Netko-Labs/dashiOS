/**
 * Earlier versions of a document's file, kept by Text Editor as it saves on
 * its own (model.ts), so File › Revert To… can go back to any of them. Each
 * file's versions are a folder of its own in
 * `$XDG_STATE_HOME/dashi/editor/versions/` (only the person's: 0700 and
 * 0600), named by a hash of the file's path: `path` holds the path, and each
 * version is `<time>-<kind>.txt`, its text with `\n` line endings.
 *
 * A version is kept of the file as it was opened, before the first save
 * over it; of the text as ❖S saved it; and, while saving on its own, of the
 * file it is about to replace at most every `AUTO_EVERY` ms. One the same as
 * the newest is not kept again. Old ones thin out (`thinVersions`): all of
 * the last hour, one an hour for the last day, one a day for a month.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type VersionKind = "opened" | "saved" | "auto";

export interface Version {
  /** When the text was the file's (ms since the epoch). */
  time: number;
  kind: VersionKind;
}

/** At most one version an autosave keeps in this long (10 minutes). */
export const AUTO_EVERY = 10 * 60 * 1000;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Versions kept for a file, at most. */
export const MAX_VERSIONS = 60;

const NAME = /^(\d+)-(opened|saved|auto)\.txt$/;

export function versionsDir(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "editor", "versions");
}

/**
 * Which of `versions` (newest first) to keep at `now`: every one from the
 * last hour, the newest of each hour of the last day and of each day of the
 * last 30, and always the newest; at most `MAX_VERSIONS`.
 */
export function thinVersions(versions: readonly Version[], now: number): Version[] {
  const kept: Version[] = [];
  const buckets = new Set<string>();
  for (const [index, version] of versions.entries()) {
    const age = now - version.time;
    let bucket: string | null;
    if (index === 0 || age < HOUR) bucket = `n${index}`;
    else if (age < DAY) bucket = `h${Math.floor(version.time / HOUR)}`;
    else if (age < 30 * DAY) bucket = `d${Math.floor(version.time / DAY)}`;
    else bucket = null;
    if (bucket === null || buckets.has(bucket)) continue;
    buckets.add(bucket);
    kept.push(version);
    if (kept.length >= MAX_VERSIONS) break;
  }
  return kept;
}

const fileName = (version: Version): string => `${version.time}-${version.kind}.txt`;

/** One folder of versions per file, under `dir`. */
export class VersionStore {
  constructor(private readonly dir: string = versionsDir()) {}

  private folder(path: string): string {
    return join(this.dir, createHash("sha256").update(path).digest("hex").slice(0, 24));
  }

  /** `path`'s versions, newest first. */
  list(path: string): Version[] {
    try {
      return readdirSync(this.folder(path))
        .flatMap((name) => {
          const match = NAME.exec(name);
          return match ? [{ time: Number(match[1]), kind: match[2] as VersionKind }] : [];
        })
        .sort((a, b) => b.time - a.time);
    } catch {
      return [];
    }
  }

  /** A version's text, or null when it is gone. */
  read(path: string, version: Version): string | null {
    try {
      return readFileSync(join(this.folder(path), fileName(version)), "utf8");
    } catch {
      return null;
    }
  }

  /** When `path`'s newest version is from, or null without one. */
  newest(path: string): number | null {
    return this.list(path)[0]?.time ?? null;
  }

  /**
   * Keeps `text` as a version of `path` from `time`, unless it is what the
   * newest already holds; then thins the old ones. Whether it was kept.
   * A version kept later is never listed before an earlier one: its time is
   * at least a millisecond after the newest's. A quick save writes the file
   * twice within one millisecond, and versions from the same one listed in
   * the folder's order, which differs between file systems.
   */
  add(path: string, text: string, kind: VersionKind, time: number, now: number = Date.now()): boolean {
    const folder = this.folder(path);
    const versions = this.list(path);
    const newest = versions[0];
    if (newest && this.read(path, newest) === text) return false;
    const version = { time: Math.max(Math.round(time), (newest?.time ?? Number.NEGATIVE_INFINITY) + 1), kind };
    const file = join(folder, fileName(version));
    const partial = `${file}.writing`;
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      writeFileSync(join(folder, "path"), path, { mode: 0o600 });
      writeFileSync(partial, text, { mode: 0o600 });
      renameSync(partial, file);
    } catch {
      rmSync(partial, { force: true });
      return false;
    }
    const all = [version, ...versions.filter((each) => fileName(each) !== fileName(version))].sort((a, b) => b.time - a.time);
    const kept = new Set(thinVersions(all, now).map(fileName));
    for (const each of all) if (!kept.has(fileName(each))) rmSync(join(folder, fileName(each)), { force: true });
    return true;
  }
}

const pad = (n: number): string => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** When a version is from, as Revert To… lists it: "Today 10:42", "Yesterday 18:03", "Tuesday 09:15", "Nov 2 09:15", "Nov 2, 2025". Local time. */
export function versionWhen(time: number, now: number): string {
  const at = new Date(time);
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const day = (date: Date): number => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(at)) / DAY);
  if (days <= 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${WEEKDAYS[at.getDay()]} ${clock}`;
  const date = `${MONTHS[at.getMonth()]} ${at.getDate()}`;
  return at.getFullYear() === new Date(now).getFullYear() ? `${date} ${clock}` : `${date}, ${at.getFullYear()}`;
}

/** What a version was: the file as it was opened, the text as ❖S saved it, or neither (said by its time alone). */
export function versionKindLabel(kind: VersionKind): string | null {
  return kind === "opened" ? "As opened" : kind === "saved" ? "Saved" : null;
}

/** How a version differs from the text now, in a few words: "Same as now", "Differs from line 12". */
export function versionDifference(version: string, now: string): string {
  if (version === now) return "Same as now";
  const a = version.split("\n");
  const b = now.split("\n");
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  return `Differs from line ${(line + 1).toLocaleString("en-US")}`;
}
