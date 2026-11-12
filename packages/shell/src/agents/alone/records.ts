/**
 * The records of Work alone, kept for the person to read later:
 * `$XDG_STATE_HOME/dashi/agents/alone.json`, the last ten times it ran,
 * newest first, each with the calls agents made meanwhile (never their
 * arguments, text or pictures). Settings › Agents lists them.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { bool, type Infer, int, lenientList, list, literal, maybe, obj, str } from "@dashi/shape";
import { isScope, stateDir } from "../consent.ts";
import type { AloneRecord } from "./types.ts";

/** How many times it keeps, and how many calls of each. */
export const RECORDS_KEPT = 10;
export const CALLS_KEPT = 500;

const Call = obj({
  time: int({ min: 0 }),
  agent: str({ max: 64 }),
  tool: str({ max: 64 }),
  sites: list(str({ max: 253 }), { max: 16 }),
  outcome: literal("ok", "error", "cancelled"),
  free: bool(),
});

const Kept = obj({
  started: int({ min: 0 }),
  ended: int({ min: 0 }),
  why: literal("stopped", "time", "locked", "logout"),
  scopes: list(str({ max: 32 }), { max: 32 }),
  sites: list(str({ max: 253 }), { max: 64 }),
  calls: lenientList(Call, { max: CALLS_KEPT }),
  more: int({ min: 0 }),
});

const File = obj({ version: literal(1), records: lenientList(Kept, { max: RECORDS_KEPT }) });

const toRecord = (kept: Infer<typeof Kept>): AloneRecord => ({ ...kept, scopes: kept.scopes.filter(isScope) });

export class AloneRecords {
  private records: readonly AloneRecord[];
  private readonly listeners = new Set<() => void>();

  /** `path` null keeps them in memory only (tests). */
  constructor(private readonly path: string | null = join(stateDir(), "alone.json")) {
    let read: unknown = null;
    try {
      if (path) read = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // None kept yet.
    }
    this.records = (maybe(File, read)?.records ?? []).map(toRecord);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Newest first. */
  getSnapshot = (): readonly AloneRecord[] => this.records;

  add(record: AloneRecord): void {
    this.records = [record, ...this.records].slice(0, RECORDS_KEPT);
    if (this.path) {
      try {
        mkdirSync(dirname(this.path), { recursive: true });
        writeFileSync(this.path, JSON.stringify({ version: 1, records: this.records }), { mode: 0o600 });
      } catch (error) {
        console.error("dashi-shell: could not save the record of agents working alone:", error);
      }
    }
    for (const listener of this.listeners) listener();
  }
}
