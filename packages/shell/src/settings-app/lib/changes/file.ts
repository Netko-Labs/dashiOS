/**
 * The change log's file, `$XDG_STATE_HOME/dashi/settings-changes.json`:
 * `{version: 1, entries: [...]}`, newest first, as log.ts writes it. Read
 * once when the shell starts; anything that isn't an entry is skipped.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Actor } from "../../../acting.ts";
import type { Change, ChangeEntry, ChangeWords } from "./log.ts";

type Raw = Record<string, unknown>;
const isRaw = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, most = 200): value is string => typeof value === "string" && value.length <= most;

export function changesPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "dashi", "settings-changes.json");
}

function readActor(value: unknown): Actor | null | undefined {
  if (value === null) return null;
  if (!isRaw(value) || !isText(value.agent, 64) || value.agent === "") return undefined;
  return isText(value.key, 4096) ? { agent: value.agent, key: value.key } : { agent: value.agent };
}

function readChange(value: unknown): Change | null {
  if (!isRaw(value) || !isText(value.key, 128) || !/^[A-Za-z]+\.[A-Za-z0-9]+$/.test(value.key)) return null;
  return { key: value.key, from: value.from, to: value.to };
}

function readWords(value: unknown): ChangeWords | null {
  if (!isRaw(value) || !isText(value.name) || !isText(value.menu) || !isText(value.from) || !isText(value.to)) return null;
  return { name: value.name, menu: value.menu, from: value.from, to: value.to, ...(isText(value.row) ? { row: value.row } : {}) };
}

/** The entries a file holds. Never throws. */
export function parseEntries(value: unknown): ChangeEntry[] {
  if (!isRaw(value) || value.version !== 1 || !Array.isArray(value.entries)) return [];
  return value.entries.flatMap((raw): ChangeEntry[] => {
    if (!isRaw(raw) || typeof raw.id !== "number" || !Number.isInteger(raw.id) || typeof raw.at !== "number" || !Array.isArray(raw.changes)) return [];
    const by = readActor(raw.by);
    const words = readWords(raw.words);
    const changes = raw.changes.map(readChange);
    if (by === undefined || !words || changes.length === 0 || changes.some((change) => change === null)) return [];
    return [{ id: raw.id, at: raw.at, by, changes: changes as Change[], words, undone: raw.undone === true }];
  });
}

/** The entries kept at `path`; none when it is missing or unreadable. */
export function readEntries(path: string): ChangeEntry[] {
  try {
    return parseEntries(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return [];
  }
}
