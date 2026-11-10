/**
 * What the Calculator remembers between launches, in
 * `$XDG_STATE_HOME/dashi/calculator.json`: the tape (the last 200 sums),
 * whether it is shown, and the window's size. History, not a setting, so
 * state rather than config. Written whole, atomically (a temporary file
 * renamed over the old one), 0600; a missing or damaged file is a fresh
 * start, never an error.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Size } from "../../kit/index.ts";
import type { TapeEntry } from "./line.ts";

/** Sums the tape keeps; older ones fall off its top. */
export const TAPE_LIMIT = 200;

export interface Remembered {
  tape: TapeEntry[];
  showsTape: boolean;
  /** The window's last size, when one was seen. */
  size: Size | null;
}

export const FRESH: Remembered = { tape: [], showsTape: false, size: null };

export function storePath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const state = env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state");
  return join(state, "dashi", "calculator.json");
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** One tape entry from the file, or null when it isn't one. */
function entryFrom(value: unknown): TapeEntry | null {
  if (!isRecord(value)) return null;
  const { expression, value: result } = value;
  if (typeof expression !== "string" || expression.length > 500 || typeof result !== "number" || !Number.isFinite(result)) return null;
  return { expression, value: result };
}

function sizeFrom(value: unknown): Size | null {
  if (!isRecord(value)) return null;
  const { width, height } = value;
  const isSide = (side: unknown): side is number => typeof side === "number" && Number.isFinite(side) && side >= 100 && side <= 10_000;
  return isSide(width) && isSide(height) ? { width: Math.round(width), height: Math.round(height) } : null;
}

/** The file's contents read, keeping what is well formed and dropping the rest. */
export function parseRemembered(value: unknown): Remembered {
  if (!isRecord(value) || value.version !== 1) return FRESH;
  const tape = Array.isArray(value.tape) ? value.tape.map(entryFrom).filter((entry): entry is TapeEntry => entry !== null) : [];
  return { tape: tape.slice(-TAPE_LIMIT), showsTape: value.showsTape === true, size: sizeFrom(value.size) };
}

export function readRemembered(path: string = storePath()): Remembered {
  try {
    return parseRemembered(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return FRESH;
  }
}

export function writeRemembered(remembered: Remembered, path: string = storePath()): void {
  const tape = remembered.tape.slice(-TAPE_LIMIT);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ version: 1, ...remembered, tape }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch (error) {
    console.error(`calculator: could not remember the tape: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** A tape with `entry` added at its foot, the oldest dropped past the limit. */
export function withEntry(tape: readonly TapeEntry[], entry: TapeEntry): TapeEntry[] {
  return [...tape, entry].slice(-TAPE_LIMIT);
}
