/**
 * The launcher's public types: a slow source's row, a scope, and what the
 * launcher reads and asks of agents (Ask, and handing off).
 *
 * A launcher scope: the same panel narrowed to one source's rows, with a
 * chip naming it ("Clipboard ›"), its own placeholder, its rows' verbs and
 * keys, and its own hints at the field's end. The clipboard history (⌥❖V)
 * and snippets are scopes (clipboard/lib/scope.ts). Choosing the action at a
 * scope's `address` in the launcher enters it in place; a key or a link to
 * that address opens the launcher in it. Esc leaves it: back to the whole
 * launcher, or closed when it was opened for the scope alone.
 *
 * A scope's rows and verbs are pure reads of its store (`getSnapshot`); a
 * verb's effect is `{ kind: "scope", verb }`, which the launcher hands to
 * `run` with the row and what is typed, and does what the answer says.
 */

import type { Outcome } from "../actions/types.ts";
import type { AnswererInfo, HandoffHarness, HarnessId, HistoryEntry, NowItem, RunView, TaskContext, TaskView } from "../agents/index.ts";
import type { Store } from "./host.ts";
import type { AgentAct } from "./lib/agents/acts.ts";
import type { Row, RowIcon } from "./row-model.ts";
import type { Section } from "./sections.ts";
import type { Hint, Verb } from "./verbs.ts";

/** What the launcher does once a scope's verb ran. */
export interface ScopeResult {
  /** The launcher closes (the paste goes to the window under it). */
  close?: true;
  /** A word at the field's right end ("Pinned"). */
  notice?: { text: string; ok: boolean };
  /** What the field holds next ("" once a snippet was added). */
  query?: string;
}

export interface LauncherScope {
  id: string;
  /** The action that opens it (`dashi://clipboard/history`). */
  address: string;
  chip: { title: string; icon?: RowIcon };
  placeholder: string;
  subscribe(listener: () => void): () => void;
  getSnapshot(): unknown;
  /** The rows for what is typed. A section with `window` draws that many rows at once, scrolled with the selection. */
  sections(query: string): Section[];
  /** A row's verbs, the first being what ↩ does. */
  verbs(row: Row, query: string): Verb[];
  /** The field's right end for the selected row. */
  hints(row: Row | undefined): Hint[];
  run(verb: string, row: Row | undefined, query: string): ScopeResult | Promise<ScopeResult>;
}

/** One row a slow source found: what it says, and what choosing it does. */
export interface SlowRow {
  id: string;
  title: string;
  detail?: string;
  /** A full-color icon path (the provider's app). */
  icon?: string;
  run(): Promise<Outcome>;
}

/** What the launcher reads about agents. */
export interface LauncherAgentsSnapshot {
  /** Who answers an Ask; null when none is (none chosen, or not yet). */
  answerer: AnswererInfo | null;
  /** Nothing picked yet: ⇥ offers to set one up. */
  unset: boolean;
  now: readonly NowItem[];
  tasks: readonly TaskView[];
}

/** What the launcher does with agents (agents/ask/service.ts makes it). */
export interface LauncherAgents extends Store<LauncherAgentsSnapshot> {
  /** Ask about `request` (with what the context chips left on, in words): the new task's id, or null with no answerer. */
  ask(request: string, context?: string): string | null;
  followUp(task: string, text: string): boolean;
  /** Return on a plan: runs it if the person's own press did it (input-origin). */
  run(task: string): void;
  allowOnce(task: string, step: number): void;
  retry(task: string): void;
  /** Put a settings change back; `entry` is the plan's history id (`entryOf`). */
  undo(entry: string, step: number, undo: AgentUndo): Promise<Outcome>;
  entryOf(task: string): string | null;
  stop(item: NowItem): void;
  /** A "Your turn": bring its window forward. */
  goTo(item: NowItem): Promise<void>;
  /** Settings › Agents. */
  setUp(): void;
  /** Terminal, to sign a harness in (a "not signed in" failure). */
  signIn(): void;
  history(): readonly HistoryEntry[];
  /** The launcher closed: a failed ask leaves "Now" (agents/ask/tasks.ts). */
  closed?(): void;
}

type AgentUndo = Extract<AgentAct, { kind: "undo" }>["undo"];

/** What the launcher reads about handing off: the harnesses installed (the first is Return's) and the runs. */
export interface HandoffSnapshot {
  harnesses: readonly HandoffHarness[];
  runs: readonly RunView[];
}

/** What the launcher does with agents from the launcher (boot/agents.ts makes it from agents/handoff/service.ts). */
export interface LauncherHandoff extends Store<HandoffSnapshot> {
  /** Whether the grants card shows before a task with this context starts (once per kind). */
  needsCard(context: TaskContext): boolean;
  /** Start it in the background; `watch` opens its card in the menu bar's panel too. */
  start(input: { harness: HarnessId; request: string; context: TaskContext }, watch: boolean): void;
  /** The menu bar's panel, on this run's card. */
  open(run: string | null): void;
  /** Words to a run: false when there's no such run. */
  tell(run: string, text: string): boolean;
  stop(run: string): void;
  /** Settings › Agents. */
  settings(): void;
  /** Terminal, to sign a harness in. */
  signIn(harness: HarnessId): void;
}
