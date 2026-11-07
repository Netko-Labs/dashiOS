/**
 * What an agent started from the launcher may use, in words, from the
 * sandbox's real limits (docs/secrets.md, "A task from the launcher"), and
 * the memory of which kinds of task the person has seen them for: the card
 * shows once per kind (the same grants), then Return starts straight away.
 * Settings › Agents' "Don't ask for these again" turns the card off.
 *
 * What the limits are, and what holds them:
 * - Websites: Dashi's website tools (the "Use websites" scope, granted for
 *   the task), each site asked about the first time (sites.ts).
 * - Logins and payments: granted for the task, and every login and payment
 *   is asked about on its own (the broker; dashi-secretd's approval).
 * - What it sees: the words, and the window in front and the selection when
 *   their chips are on; it may hand that window to the person (hand_over).
 * - Not your files: its home folder is an empty one in the sandbox, and
 *   "Browse your files" is refused.
 * - Not other windows: "See windows and apps", "See the screen" and "Manage
 *   windows and apps" are refused for the task.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Scope } from "../consent.ts";
import { stateDir } from "../consent.ts";
import { cut } from "./words.ts";

/** The window in front when the launcher opened, and what was selected: what the context chips offer. */
export interface TaskContext {
  window: { id: number; app: string; title: string; site: string | null; url: string | null } | null;
  selection: string | null;
}

export const NO_CONTEXT: TaskContext = { window: null, selection: null };

/** The scopes a task is granted for its connection; each still asks per site, login or payment. */
export const TASK_GRANTED: readonly Scope[] = ["web", "signin", "pay"];
/** The scopes a task is refused, whatever it asks: its card strikes them. */
export const TASK_REFUSED: readonly Scope[] = ["see", "screen", "act", "files", "clipboard"];

/** "Helium · bodytech.com.co": a context chip's words for a window. */
export function windowWords(window: NonNullable<TaskContext["window"]>): string {
  const place = window.site ?? cut(window.title, 40);
  return place && place !== window.app ? `${window.app} · ${place}` : window.app;
}

export interface GrantLine {
  id: string;
  words: string;
  /** False: what it can't (struck through on the card). */
  allowed: boolean;
}

/** The card's lines for a task with this context (only the chips left on). */
export function taskGrants(context: TaskContext): GrantLine[] {
  return [
    { id: "web", words: "Websites: asks per site", allowed: true },
    { id: "logins", words: "Your logins: asks each time", allowed: true },
    { id: "pay", words: "Payments: asks each time", allowed: true },
    ...(context.window ? [{ id: "window", words: `Sees: ${windowWords(context.window)}`, allowed: true }] : []),
    ...(context.selection ? [{ id: "selection", words: "Sees: your selection", allowed: true }] : []),
    { id: "files", words: "Your files", allowed: false },
    { id: "windows", words: "Other windows", allowed: false },
  ];
}

/** A kind of task: the same grants, whatever the words or the site ("web+logins+pay+window"). */
export function grantsKind(lines: readonly GrantLine[]): string {
  return lines
    .filter((line) => line.allowed)
    .map((line) => line.id)
    .sort()
    .join("+");
}

/** Where the kinds seen are kept: `$XDG_STATE_HOME/dashi/agents/handoff.json`. */
export const handoffPath = (): string => join(stateDir(), "handoff.json");

/** The kinds of task whose card the person has seen (and started from). */
export class GrantsMemory {
  private seen: Set<string> | null = null;

  constructor(private readonly path: string | null = handoffPath()) {}

  /** Whether the card shows before a task of this kind starts. */
  needsCard(kind: string, skip: boolean): boolean {
    return !skip && !this.load().has(kind);
  }

  /** The person started from the card: this kind starts straight away from now on. */
  remember(kind: string): void {
    const seen = this.load();
    if (seen.has(kind)) return;
    seen.add(kind);
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ seen: [...seen].sort() }, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      console.error("dashi-shell: couldn't keep the agents' card memory:", error);
    }
  }

  /** Every kind forgotten: the card shows again. */
  forget(): void {
    this.seen = new Set();
    if (!this.path) return;
    try {
      writeFileSync(this.path, `${JSON.stringify({ seen: [] })}\n`, { mode: 0o600 });
    } catch {
      // Nothing kept: nothing to forget.
    }
  }

  private load(): Set<string> {
    if (this.seen) return this.seen;
    this.seen = new Set();
    if (!this.path) return this.seen;
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      const seen = typeof value === "object" && value !== null ? (value as { seen?: unknown }).seen : null;
      if (Array.isArray(seen)) for (const kind of seen) if (typeof kind === "string" && kind.length <= 200) this.seen.add(kind);
    } catch {
      // None kept yet.
    }
    return this.seen;
  }
}

/** What the task's harness is told of its context: the window in front and the selection, when their chips are on. */
export function contextPrompt(context: TaskContext): string {
  const lines: string[] = [];
  const window = context.window;
  if (window) {
    const where = window.url ? `, showing ${window.url}` : window.title ? `, titled “${cut(window.title, 120)}”` : "";
    lines.push(`The window in front is ${window.app} (window w${window.id}${where}). You may hand it to the person with hand_over.`);
  }
  if (context.selection) lines.push(`The person selected this:\n"""\n${cut(context.selection, 4000)}\n"""`);
  return lines.join("\n");
}
