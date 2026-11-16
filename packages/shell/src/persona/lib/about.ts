/**
 * "What I know about you" (decisions.md D151): one plain file the person
 * reads and edits (Settings › Your Dashi opens it), given to Dashi's
 * assistant at the start of each conversation: what to call them, the
 * sites and apps they name with their real spellings, standing wishes.
 * Dashi writes to it only when the person says "remember…": one line each
 * time, never silently, and never a secret's place (it is a text file).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The most of the file that goes with a conversation. */
export const ABOUT_MAX = 2000;
/** The longest line Dashi adds. */
export const ABOUT_LINE_MAX = 240;

export const aboutPath = (env: Readonly<Record<string, string | undefined>> = process.env): string =>
  join(env.XDG_CONFIG_HOME || join(env.HOME ?? "", ".config"), "dashi", "about-you.md");

/** What the file says, as it goes to the assistant: its text, cut at `ABOUT_MAX`; "" when there is none. */
export function readAbout(path: string = aboutPath()): string {
  try {
    const text = readFileSync(path, "utf8")
      .replace(/\p{Cc}+/gu, (run) => (run.includes("\n") ? "\n" : " "))
      .trim();
    return text.length > ABOUT_MAX ? text.slice(0, ABOUT_MAX) : text;
  } catch {
    return "";
  }
}

/** The file, made empty if it is not there yet, so it can be opened and written in. Its path. */
export function ensureAbout(path: string = aboutPath()): string {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, "", { mode: 0o600 });
  }
  return path;
}

/** Add one line the person asked Dashi to remember; false when it could not be written. */
export function rememberAbout(fact: string, path: string = aboutPath()): boolean {
  const line = fact
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, ABOUT_LINE_MAX);
  if (line === "") return false;
  try {
    ensureAbout(path);
    const before = readFileSync(path, "utf8");
    appendFileSync(path, `${before === "" || before.endsWith("\n") ? "" : "\n"}- ${line}\n`);
    return true;
  } catch {
    return false;
  }
}
