/**
 * Whether this person has been through the Setup Assistant: one small file,
 * `$XDG_STATE_HOME/dashi/setup.json` (per user, under their home like the
 * agents' grants), written when they finish or skip. Without it the
 * assistant opens at the first login; with it, only when asked for (About,
 * the launcher, an agent). Read strictly: anything but a file this module
 * wrote counts as "not done yet", which shows the assistant once more at
 * worst.
 *
 *   { "version": 1, "outcome": "finished" | "skipped", "at": "2026-10-30T12:00:00.000Z" }
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeTextAtomic } from "../shared/fs/atomic.ts";

export type SetupOutcome = "finished" | "skipped";

export interface SetupRecord {
  outcome: SetupOutcome;
  /** When, as an ISO 8601 time. */
  at: string;
}

export const SETUP_VERSION = 1;

type Env = Readonly<Record<string, string | undefined>>;

export function setupStatePath(env: Env = process.env, home: string = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, ".local/state"), "dashi", "setup.json");
}

/** The record in a decoded file, or null for anything else. */
export function parseSetupRecord(value: unknown): SetupRecord | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { version, outcome, at } = value as Record<string, unknown>;
  if (version !== SETUP_VERSION || (outcome !== "finished" && outcome !== "skipped")) return null;
  if (typeof at !== "string" || Number.isNaN(Date.parse(at))) return null;
  return { outcome, at };
}

export function readSetupRecord(path: string = setupStatePath()): SetupRecord | null {
  if (!existsSync(path)) return null;
  try {
    return parseSetupRecord(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

/** Remember that the person finished or skipped. A failure to write is logged: the assistant then shows again next login. */
export function writeSetupRecord(outcome: SetupOutcome, path: string = setupStatePath(), now: Date = new Date()): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeTextAtomic(path, `${JSON.stringify({ version: SETUP_VERSION, outcome, at: now.toISOString() }, null, 2)}\n`);
    return true;
  } catch (error) {
    console.error("dashi-shell: could not remember that setup is done:", error instanceof Error ? error.message : error);
    return false;
  }
}

/**
 * Whether the assistant opens by itself now. `DASHI_SETUP=1` forces it (to look at it), `0` keeps
 * it away (a test rig, a managed image); otherwise it opens when this person has not been
 * through it.
 */
export function shouldOpenAtLogin(env: Env, record: SetupRecord | null): boolean {
  if (env.DASHI_SETUP === "1") return true;
  if (env.DASHI_SETUP === "0") return false;
  return record === null;
}
