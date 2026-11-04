/**
 * Changes that weren't saved when the window went. Metal can't hold a window
 * open to ask (its close ends the process), so a window closed by its close
 * button, ❖W, ❖Q, or logging out keeps what was not saved here, in
 * `$XDG_STATE_HOME/dashi/editor/recovery/` (only the person's: 0700 and
 * 0600), and the next Text Editor opened without a file brings it back as
 * an edited document. A file is taken (read and removed) once.
 */

import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Encoding, LineEnding } from "./codec.ts";

export interface Recovery {
  /** The file it was opened from, or null for Untitled. */
  path: string | null;
  text: string;
  encoding: Encoding;
  lineEnding: LineEnding;
  /** When it was kept, ms since the epoch. */
  time: number;
}

const ENCODINGS: ReadonlySet<string> = new Set(["utf-8", "utf-8-bom", "utf-16le", "utf-16be", "latin-1"]);
const LINE_ENDINGS: ReadonlySet<string> = new Set(["lf", "crlf", "cr"]);

export function recoveryDir(env: Record<string, string | undefined> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "editor", "recovery");
}

/** A recovery file's contents, or null when they are not one. */
export function parseRecovery(text: string): Recovery | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const { path, encoding, lineEnding, time } = record;
  if (typeof record.text !== "string") return null;
  if (path !== null && (typeof path !== "string" || path === "" || path.includes("\0"))) return null;
  if (typeof encoding !== "string" || !ENCODINGS.has(encoding)) return null;
  if (typeof lineEnding !== "string" || !LINE_ENDINGS.has(lineEnding)) return null;
  if (typeof time !== "number" || !Number.isFinite(time)) return null;
  return { path, text: record.text, encoding: encoding as Encoding, lineEnding: lineEnding as LineEnding, time };
}

/** Keeps `recovery`; synchronous, since it runs as the process exits. Whether it was written. */
export function keepRecovery(recovery: Recovery, dir: string = recoveryDir()): boolean {
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${recovery.time}-${process.pid}.json`), JSON.stringify(recovery), { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

/** The names of the kept files, oldest first. */
export function recoveryFiles(dir: string = recoveryDir()): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => /^\d+-\d+\.json$/.test(name))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
  } catch {
    return [];
  }
}

/** Reads and removes one kept file (a bad one is removed too); null when it is gone or bad. */
export function takeRecovery(name: string, dir: string = recoveryDir()): Recovery | null {
  if (!/^\d+-\d+\.json$/.test(name)) return null;
  // Renamed first, so two windows opening at once never both take it.
  const path = join(dir, name);
  const claimed = `${path}.${process.pid}.taking`;
  let text: string;
  try {
    renameSync(path, claimed);
    text = readFileSync(claimed, "utf8");
    unlinkSync(claimed);
  } catch {
    return null;
  }
  return parseRecovery(text);
}
