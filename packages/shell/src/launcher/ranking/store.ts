/**
 * The ranking's history on disk: `$XDG_STATE_HOME/dashi/ranking.json`, next
 * to recents.json, readable by its owner only (0600). It stays on this
 * computer. Read once when the shell starts; written a moment after the last
 * change (so a burst of openings is one write) and when the shell quits, by
 * a temporary file renamed over the old one. A missing, damaged or oversized
 * file is an empty history; a failed write is logged and the history lives
 * on in memory for the session.
 */

import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recentsPath } from "../../recents.ts";
import type { RankSignals } from "./item.ts";
import {
  decayed,
  emptyMemory,
  forget,
  type Memory,
  OPEN_HALF_LIFE,
  parseMemory,
  pickWeights,
  prune,
  recordOpen,
  recordPick,
  serializeMemory,
} from "./memory.ts";

/** A file larger than this is not ours (the bounds keep a real one far under it). */
export const MAX_FILE_BYTES = 1 << 20;
const WRITE_DELAY_MS = 2000;

export function rankingPath(env: Record<string, string | undefined> = process.env): string {
  return join(dirname(recentsPath(env)), "ranking.json");
}

export interface RankingMemoryOptions {
  path?: string;
  now?: () => number;
  /** How long after the last change the file is written. */
  delayMs?: number;
}

export class RankingMemory implements RankSignals {
  private memory: Memory;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private readonly path: string;
  private readonly now: () => number;
  private readonly delayMs: number;

  constructor(options: RankingMemoryOptions = {}) {
    this.path = options.path ?? rankingPath();
    this.now = options.now ?? Date.now;
    this.delayMs = options.delayMs ?? WRITE_DELAY_MS;
    this.memory = readMemory(this.path, this.now());
  }

  /** Something was opened, from anywhere (the Dock, the switcher, a file, the launcher). */
  opened(id: string): void {
    recordOpen(this.memory, id, this.now());
    this.changed();
  }

  /** The launcher's pick: `id` chosen for what was typed. Counts as an opening too. */
  picked(query: string, id: string): void {
    recordPick(this.memory, query, id, this.now());
    this.changed();
  }

  /** Reset Ranking on one row. */
  forget(id: string): void {
    forget(this.memory, id);
    this.changed();
  }

  /** Reset Ranking for everything. */
  forgetAll(): void {
    this.memory = emptyMemory();
    this.changed();
  }

  picks(query: string): ReadonlyMap<string, number> {
    return pickWeights(this.memory, query, this.now());
  }

  frecency(id: string): number {
    return decayed(this.memory.opened.get(id), this.now(), OPEN_HALF_LIFE);
  }

  /** Write now if anything changed (the shell is quitting). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    prune(this.memory, this.now());
    writeMemory(this.path, serializeMemory(this.memory));
  }

  close(): void {
    this.flush();
  }

  private changed(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    this.timer.unref?.();
  }
}

function readMemory(path: string, now: number): Memory {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) {
      console.error("dashi-shell: the ranking history is too large; starting over");
      return emptyMemory();
    }
    return parseMemory(readFileSync(path, "utf8"), now);
  } catch {
    return emptyMemory();
  }
}

function writeMemory(path: string, text: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, text, { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    console.error("dashi-shell: could not save the ranking history:", error instanceof Error ? error.message : error);
  }
}
