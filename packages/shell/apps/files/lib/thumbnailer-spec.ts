/**
 * A `.thumbnailer` file (freedesktop's thumbnailer entry): its command with
 * the field codes (%i %u %o %s), and the types it makes pictures of.
 */

import { fileUri } from "../../../src/shared/files/index.ts";

/** One `.thumbnailer` file: its command (with %i %u %o %s) and the types it makes pictures of. */
export interface ThumbnailerSpec {
  exec: string[];
  tryExec?: string;
  mimeTypes: string[];
}

/** The `[Thumbnailer Entry]` of a `.thumbnailer` file, or null when it lacks a command or types. */
export function parseThumbnailer(text: string): ThumbnailerSpec | null {
  let inEntry = false;
  const keys = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inEntry = line === "[Thumbnailer Entry]";
      continue;
    }
    const eq = line.indexOf("=");
    if (!inEntry || eq <= 0 || line.startsWith("#")) continue;
    keys.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  const exec = splitExec(keys.get("Exec") ?? "");
  const mimeTypes = (keys.get("MimeType") ?? "").split(";").filter(Boolean);
  if (exec.length === 0 || mimeTypes.length === 0) return null;
  const tryExec = keys.get("TryExec");
  return { exec, mimeTypes, ...(tryExec ? { tryExec } : {}) };
}

/** An Exec value as words: spaces part them, double quotes keep one whole. */
export function splitExec(value: string): string[] {
  const words: string[] = [];
  let word = "";
  let quoted = false;
  let started = false;
  for (const char of value) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(char) && !quoted) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

/** The command for one file: the field codes filled in (%i path, %u URI, %o output, %s size, %% a percent sign). */
export function thumbnailerArgv(exec: readonly string[], fill: { input: string; output: string; size: number }): string[] {
  const codes: Record<string, string> = { i: fill.input, u: fileUri(fill.input), o: fill.output, s: String(fill.size), "%": "%" };
  return exec.map((word) => word.replace(/%([iuos%])/g, (_, code: string) => codes[code] ?? ""));
}
