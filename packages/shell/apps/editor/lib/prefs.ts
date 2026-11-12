/**
 * Text Editor's View settings, kept across windows in
 * `$XDG_CONFIG_HOME/dashi/editor.json`: the monospaced font, the text size,
 * line numbers, and how far apart the tab stops are. Read when a window opens and again when another window
 * changes them (main.tsx), so every open window follows; written when one
 * changes.
 */

import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";
import { writeTextAtomic } from "../../../src/shared/fs/index.ts";

export interface EditorPrefs {
  monospace: boolean;
  fontSize: number;
  /** The line-number gutter at the text's left. */
  lineNumbers: boolean;
  /** How far apart the tab stops are, in characters of the font (its "0": mirin's `tabSize`). */
  tabWidth: TabWidth;
}

export const TAB_WIDTHS = [2, 4, 8] as const;
export type TabWidth = (typeof TAB_WIDTHS)[number];
export const isTabWidth = (value: unknown): value is TabWidth => (TAB_WIDTHS as readonly unknown[]).includes(value);

export const FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32] as const;
export const DEFAULT_PREFS: EditorPrefs = { monospace: false, fontSize: 13, lineNumbers: true, tabWidth: 4 };

export const samePrefs = (a: EditorPrefs, b: EditorPrefs): boolean =>
  a.monospace === b.monospace && a.fontSize === b.fontSize && a.lineNumbers === b.lineNumbers && a.tabWidth === b.tabWidth;

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
  if (!isRecord(value)) return DEFAULT_PREFS;
  const record = value;
  const size = record.fontSize;
  return {
    monospace: typeof record.monospace === "boolean" ? record.monospace : DEFAULT_PREFS.monospace,
    fontSize: typeof size === "number" && (FONT_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PREFS.fontSize,
    lineNumbers: typeof record.lineNumbers === "boolean" ? record.lineNumbers : DEFAULT_PREFS.lineNumbers,
    tabWidth: isTabWidth(record.tabWidth) ? record.tabWidth : DEFAULT_PREFS.tabWidth,
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
