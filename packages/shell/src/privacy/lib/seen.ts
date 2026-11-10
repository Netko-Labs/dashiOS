/**
 * Since when an app has had a permission: the portal's permission store
 * keeps no date, so the shell writes down when it first saw each grant
 * (`$XDG_STATE_HOME/dashi/privacy/seen.json`, grant key → seconds). It looks
 * whenever the store says something changed, so a new grant is dated when
 * it was given. Grants that were there before Dashi kept dates have 0: their
 * date isn't known, and the pane says nothing about it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function seenPath(env: Record<string, string | undefined> = process.env): string {
  return join(env.XDG_STATE_HOME || join(homedir(), ".local/state"), "dashi", "privacy", "seen.json");
}

/** The file's times, checked: only whole, non-negative seconds count. */
export function parseSeen(text: string): Map<string, number> {
  const out = new Map<string, number>();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return out;
  }
  const seen = typeof value === "object" && value !== null ? (value as Record<string, unknown>).seen : undefined;
  if (typeof seen !== "object" || seen === null) return out;
  for (const [key, time] of Object.entries(seen)) {
    if (typeof time === "number" && Number.isInteger(time) && time >= 0 && key.length <= 1024) out.set(key, time);
  }
  return out;
}

/**
 * The times after looking at the grants there are now: a grant not seen
 * before is dated `now` (or 0 on the very first look, when nothing was
 * written down yet), and a grant that is gone is forgotten.
 */
export function reconcile(seen: ReadonlyMap<string, number>, keys: readonly string[], now: number, first: boolean): Map<string, number> {
  return new Map(keys.map((key) => [key, seen.get(key) ?? (first ? 0 : now)]));
}

export class SeenTimes {
  private times: Map<string, number>;
  private first: boolean;

  constructor(private readonly path: string | null = seenPath()) {
    this.first = path === null || !existsSync(path);
    this.times = new Map();
    if (path && !this.first) {
      try {
        this.times = parseSeen(readFileSync(path, "utf8"));
      } catch {
        // Unreadable: as good as new.
      }
    }
  }

  /** Since when, in seconds; null when the date isn't known. */
  since(key: string): number | null {
    const time = this.times.get(key);
    return time === undefined || time === 0 ? null : time;
  }

  /** The grants there are now. */
  update(keys: readonly string[], now: number = Math.floor(Date.now() / 1000)): void {
    const next = reconcile(this.times, keys, now, this.first);
    const changed = this.first || next.size !== this.times.size || [...next].some(([key, time]) => this.times.get(key) !== time);
    this.times = next;
    this.first = false;
    if (changed) this.save();
  }

  private save(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify({ version: 1, seen: Object.fromEntries(this.times) }));
    } catch (error) {
      console.error("dashi-shell: could not save when permissions were given:", error);
    }
  }
}
