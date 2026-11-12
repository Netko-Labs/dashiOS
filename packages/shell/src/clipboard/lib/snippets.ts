/**
 * Snippets: a keyword typed anywhere (";addr") becomes its text ("Calle de
 * la Luna 12, 2º B"). The person keeps them from the launcher ("snippet"
 * lists them and adds one: `;addr Calle de la Luna 12`), in
 * `$XDG_CONFIG_HOME/dashi/snippets.json` (0600).
 *
 * The compositor watches for the keywords (IPC `snippets`) and says when
 * one was typed (`snippet`); the policy is here. Never in a password field
 * (AT-SPI, clipboard/lib/fields.ts), never in a terminal unless Settings allows
 * it. The keyword is erased only if it is still the last thing typed
 * (`snippet-erase`), then the text is pasted, and the clipboard gets back
 * the copy it had. Placeholders: {date}, {time}, {clipboard}, {cursor}
 * (where the caret ends up).
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isRecord } from "@dashi/shape";

export interface Snippet {
  keyword: string;
  text: string;
}

export const MAX_SNIPPETS = 256;
const MAX_TEXT = 8192;

export function snippetsPath(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "dashi", "snippets.json");
}

/** Whether `keyword` can be one: 2 to 32 characters, no spaces (what the compositor takes). */
export function isKeyword(keyword: string): boolean {
  const length = [...keyword].length;
  return length >= 2 && length <= 32 && !/[\s\p{Cc}]/u.test(keyword);
}

/** What is wrong with adding `keyword` beside `existing`, in words; null when nothing. */
export function keywordProblem(keyword: string, existing: readonly Snippet[]): string | null {
  if (!isKeyword(keyword)) return "A keyword is 2 to 32 characters, with no spaces";
  for (const each of existing) {
    if (each.keyword === keyword) return `“${keyword}” is a snippet already`;
    // One keyword ending inside another would fire first, every time.
    if (keyword.startsWith(each.keyword) || each.keyword.startsWith(keyword)) return `“${keyword}” and “${each.keyword}” start alike`;
  }
  return null;
}

/** What the snippets field adds: its first word is the keyword, the rest the text (";addr Calle de la Luna 12"). */
export function parseAdd(query: string): Snippet | null {
  const trimmed = query.trim();
  const space = trimmed.search(/\s/);
  if (space <= 0) return null;
  const keyword = trimmed.slice(0, space);
  const text = trimmed.slice(space).trim();
  return isKeyword(keyword) && text !== "" ? { keyword, text } : null;
}

export function parseSnippets(value: unknown): Snippet[] {
  const list = isRecord(value) && Array.isArray(value.snippets) ? value.snippets : [];
  const kept: Snippet[] = [];
  for (const item of list) {
    if (!isRecord(item)) continue;
    const { keyword, text } = item;
    if (typeof keyword !== "string" || typeof text !== "string" || text.length > MAX_TEXT) continue;
    if (keywordProblem(keyword, kept) !== null) continue;
    kept.push({ keyword, text });
    if (kept.length >= MAX_SNIPPETS) break;
  }
  return kept;
}

export interface Expansion {
  text: string;
  /** How many characters the caret goes back from the end ({cursor}). */
  back: number;
}

/** A snippet's text with its placeholders filled in. */
export function expand(text: string, fill: { now: Date; locale?: string; clipboard: string | null }): Expansion {
  const date = new Intl.DateTimeFormat(fill.locale, { dateStyle: "medium" }).format(fill.now);
  const time = new Intl.DateTimeFormat(fill.locale, { timeStyle: "short" }).format(fill.now);
  let cursor = -1;
  let out = "";
  for (const part of text.split(/(\{(?:date|time|clipboard|cursor)\})/)) {
    if (part === "{date}") out += date;
    else if (part === "{time}") out += time;
    else if (part === "{clipboard}") out += fill.clipboard ?? "";
    else if (part === "{cursor}") cursor = cursor < 0 ? out.length : cursor;
    else out += part;
  }
  return { text: out, back: cursor < 0 ? 0 : [...out.slice(cursor)].length };
}

/** The snippets kept, and adding and taking them away. */
export class SnippetStore {
  private list: Snippet[];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly path: string = snippetsPath()) {
    let value: unknown = null;
    try {
      value = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      // None yet.
    }
    this.list = parseSnippets(value);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly Snippet[] => this.list;

  find(keyword: string): Snippet | undefined {
    return this.list.find((each) => each.keyword === keyword);
  }

  /** Add one; what is wrong with it, or null once it is kept. */
  add(snippet: Snippet): string | null {
    const problem = keywordProblem(snippet.keyword, this.list);
    if (problem) return problem;
    if (snippet.text.length > MAX_TEXT) return "That text is too long for a snippet";
    if (this.list.length >= MAX_SNIPPETS) return `${MAX_SNIPPETS} snippets is the most`;
    this.set([...this.list, snippet].sort((a, b) => a.keyword.localeCompare(b.keyword)));
    return null;
  }

  remove(keyword: string): void {
    this.set(this.list.filter((each) => each.keyword !== keyword));
  }

  private set(list: Snippet[]): void {
    this.list = list;
    try {
      const dir = dirname(this.path);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const temp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify({ snippets: list }, null, 2)}\n`, { mode: 0o600 });
      chmodSync(temp, 0o600);
      renameSync(temp, this.path);
    } catch (error) {
      console.error("dashi-shell: snippets could not be saved:", error);
    }
    for (const listener of this.listeners) listener();
  }
}
