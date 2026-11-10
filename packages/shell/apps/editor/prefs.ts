/**
 * Text Editor's View settings, kept across windows in
 * `$XDG_CONFIG_HOME/dashi/editor.json`: the monospaced font, the text size,
 * and line numbers. Read when a window opens and again when another window
 * changes them (main.tsx), so every open window follows; written when one
 * changes.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { writeTextAtomic } from "../../src/shared/fs/private-text.ts";

export interface EditorPrefs {
  monospace: boolean;
  fontSize: number;
  /** The line-number gutter at the text's left. */
  lineNumbers: boolean;
}

export const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32] as const;
export const DEFAULT_PREFS: EditorPrefs = { monospace: false, fontSize: 13, lineNumbers: true };

export const samePrefs = (a: EditorPrefs, b: EditorPrefs): boolean =>
  a.monospace === b.monospace && a.fontSize === b.fontSize && a.lineNumbers === b.lineNumbers;

export function prefsPath(env: Record<string, string | undefined> = process.env): string {
  const config = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(config, "dashi", "editor.json");
}

/** The settings in a file's text; the defaults for anything missing or wrong. */
export function parsePrefs(text: string): EditorPrefs {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return DEFAULT_PREFS;
  const record = value as Record<string, unknown>;
  const size = record.fontSize;
  return {
    monospace: typeof record.monospace === "boolean" ? record.monospace : DEFAULT_PREFS.monospace,
    fontSize: typeof size === "number" && (FONT_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PREFS.fontSize,
    lineNumbers: typeof record.lineNumbers === "boolean" ? record.lineNumbers : DEFAULT_PREFS.lineNumbers,
  };
}

/** The next size up (`step` 1) or down (-1) the list, staying at its ends. */
export function stepFontSize(size: number, step: 1 | -1): number {
  const first = FONT_SIZES[0];
  const last = FONT_SIZES[FONT_SIZES.length - 1] as number;
  if (step === 1) return FONT_SIZES.find((each) => each > size) ?? last;
  return FONT_SIZES.findLast((each) => each < size) ?? first;
}

export function readPrefs(path: string = prefsPath()): EditorPrefs {
  try {
    return parsePrefs(readFileSync(path, "utf8"));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writePrefs(prefs: EditorPrefs, path: string = prefsPath()): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeTextAtomic(path, `${JSON.stringify(prefs, null, 2)}\n`);
  } catch {
    // Settings that can't be kept still apply to this window.
  }
}
