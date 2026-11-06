/**
 * Agents in the launcher, as rows (docs/betterments.html, "Agents in the
 * launcher", recommendation B everywhere). Pure: the launcher draws them,
 * the tests read them.
 *
 * - Local first: the rows the ranking found never wait for anything. An Ask
 *   row is added last, never selected for you, only for a sentence (three or
 *   more words, a verb first, or a "?") or after ⇥, and only when an
 *   answerer is chosen. It says where the words go.
 * - With nothing picked yet, ⇥ offers "Set up an agent…" instead; "None"
 *   chosen hides Ask altogether.
 * - An empty launcher shows "Now" on top: a "Your turn" first, then the
 *   launcher's tasks, then connected agents, each with a shiso dot and Stop.
 * - "history" lists what agents did, grouped by task.
 */

import type { Outcome } from "../../actions/types.ts";
import type { AnswererInfo } from "../../agents/ask/answerer.ts";
import { ago, type HistoryEntry } from "../../agents/ask/history.ts";
import type { NowItem } from "../../agents/ask/now.ts";
import type { TaskView } from "../../agents/ask/tasks.ts";
import { SPARKLE } from "../../settings-app/glyphs.ts";
import type { Store } from "../host.ts";
import { fold } from "../ranking/fold.ts";
import type { Row } from "../row-model.ts";
import type { Section } from "../rows.ts";
import type { Hint, Verb } from "../verbs.ts";
import type { AgentAct } from "./acts.ts";

export type { AgentAct } from "./acts.ts";

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
  /** Ask about `request`: the new task's id, or null with no answerer. */
  ask(request: string): string | null;
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
}

type AgentUndo = Extract<AgentAct, { kind: "undo" }>["undo"];

/** Words that start a request rather than name a thing. */
const VERBS = new Set(
  "turn make set put open close hide show move switch start stop play pause mute unmute add create new join connect disconnect lock clear change find tile arrange quit enable disable remind schedule write send take go bring use help what how why when where who can could please".split(
    " ",
  ),
);

/** Whether the words read like a request to do something, not a name to find. */
export function readsLikeSentence(query: string): boolean {
  const text = query.trim();
  if (text.endsWith("?") && text.length > 1) return true;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return true;
  return words.length === 2 && VERBS.has(fold(words[0] ?? ""));
}

export const ASK_ROW = "ask";
export const SET_UP_ROW = "set-up-agent";

const act = (value: AgentAct) => ({ kind: "agent" as const, act: value });

/** The Ask row: shiso glyph and words, and where they go. */
export function askRow(query: string, answerer: AnswererInfo): Row {
  return {
    id: ASK_ROW,
    title: `Ask: ${query.trim()}`,
    kind: answerer.where,
    icon: { glyph: SPARKLE },
    action: act({ kind: "ask", query: query.trim() }),
    agent: "ask",
  };
}

export const setUpRow: Row = {
  id: SET_UP_ROW,
  title: "Set up an agent…",
  detail: "choose who answers in System Settings",
  kind: "Settings",
  icon: { glyph: SPARKLE },
  action: act({ kind: "set-up" }),
};

export function nowRow(item: NowItem): Row {
  const base = { icon: { glyph: SPARKLE }, agent: "dot" as const, stop: true as const, action: act({ kind: "now", item }) };
  switch (item.kind) {
    case "turn":
      return { ...base, id: `now:turn:${item.agent}`, title: item.name, detail: `Your turn: ${item.reason}`, kind: "Your turn" };
    case "task":
      return { ...base, id: `now:task:${item.id}`, title: item.name, detail: item.status, kind: "" };
    case "agent":
      return { ...base, id: `now:agent:${item.id}`, title: item.name, detail: item.status, kind: "" };
  }
}

export function historyRow(entry: HistoryEntry, now: number): Row {
  return {
    id: `history:${entry.id}`,
    title: entry.request ? `${entry.who}: ${entry.request}` : entry.who,
    detail: `${entry.summary} · ${ago(entry.time, now)}`,
    kind: entry.open ? "Connected" : "History",
    icon: { glyph: SPARKLE },
    action: act({ kind: "history", entry }),
  };
}

/** What "history" in the launcher answers to. */
export const isHistoryQuery = (query: string): boolean => ["history", "agent history", "agents history", "agent activity"].includes(fold(query));

/** "Now" rows an empty launcher shows at most, so Recent keeps its place. */
export const NOW_ROWS = 3;
/** History rows the launcher shows; Settings › Agents has the rest. */
export const HISTORY_ROWS = 5;

export interface AgentRowsInput {
  query: string;
  allApps: boolean;
  snapshot: LauncherAgentsSnapshot | null;
  /** ⇥ was pressed for these words. */
  tabbed: boolean;
  /** Read only when the words ask for it (`isHistoryQuery`). */
  history?: () => readonly HistoryEntry[];
  /** Seconds, for "5 min ago". */
  now: number;
}

/** The launcher's sections with agents' added: Now on top of an empty field, history, then Ask last. */
export function withAgents(sections: readonly Section[], input: AgentRowsInput): Section[] {
  const query = input.query.trim();
  const snapshot = input.snapshot;
  if (!snapshot) return [...sections];
  if (!query) {
    if (input.allApps || snapshot.now.length === 0) return [...sections];
    return [{ id: "now", title: "Now", rows: snapshot.now.slice(0, NOW_ROWS).map(nowRow) }, ...sections];
  }
  let out = [...sections];
  if (isHistoryQuery(query) && input.history) {
    const entries = input.history().slice(0, HISTORY_ROWS);
    const rows = entries.length > 0 ? entries.map((entry) => historyRow(entry, input.now)) : [];
    if (rows.length > 0) out = [...out.filter((section) => section.id !== "nothing"), { id: "history", title: "Agent history", rows }];
  }
  // A sum or a conversion is answered here already ("15% of 80"): Ask only if ⇥ asks for it.
  const answered = sections.some((section) => section.rows.some((row) => row.id === "answer"));
  if (snapshot.answerer && (input.tabbed || (readsLikeSentence(query) && !answered))) return [...out, { id: "ask", rows: [askRow(query, snapshot.answerer)] }];
  if (!snapshot.answerer && snapshot.unset && input.tabbed) return [...out, { id: "set-up", rows: [setUpRow] }];
  return out;
}

/** "⇥ Ask" at the field's right end, for words that read like a request, when someone answers. */
export function askHint(query: string, snapshot: LauncherAgentsSnapshot | null): Hint[] {
  return snapshot?.answerer && readsLikeSentence(query) ? [{ keys: "⇥", label: "Ask" }] : [];
}

/** The placeholder when someone answers: the field takes words to do, not only names. */
export const ASK_PLACEHOLDER = "Search, or say what to do";

/** The stop square's press for a row that has one (a Now row), as ResultRow props. */
export function withStop(row: Row, run: (act: AgentAct) => void): { onStop?: () => void } {
  const action = row.action;
  if (!row.stop || action.kind !== "agent" || action.act.kind !== "now") return {};
  const item = action.act.item;
  return { onStop: () => run({ kind: "stop", item }) };
}

/** The row selected with nothing held: the first, but never the Ask row (it is chosen, not given). */
export function firstChoice(ids: readonly string[]): string | null {
  return ids.find((id) => id !== ASK_ROW) ?? null;
}

const verb = (id: string, title: string, value: AgentAct, extra: Partial<Verb> = {}): Verb => ({ id, title, effect: act(value), ...extra });

/** An agents' row's verbs, the first being what ↩ does. */
export function agentVerbs(value: AgentAct): Verb[] {
  switch (value.kind) {
    case "now": {
      const { item } = value;
      const stop = verb("stop", item.kind === "task" ? "Stop" : `Stop ${item.name}`, { kind: "stop", item }, { danger: true });
      if (item.kind === "turn") return [verb("go", "Go to window", value, { key: "↩" }), stop];
      if (item.kind === "task") return [verb("plan", "Show plan", value, { key: "↩" }), stop];
      return [verb("history", "Show in Settings", { kind: "set-up" }, { key: "↩" }), stop];
    }
    case "history": {
      const { entry } = value;
      const undos = entry.steps.flatMap((step, index) =>
        step.undo && !step.undone && step.outcome === "done"
          ? [verb(`undo:${index}`, `Undo: ${step.undo.title}`, { kind: "undo", entry: entry.id, index, undo: step.undo })]
          : [],
      );
      return [verb("show", "Show in Settings", value, { key: "↩" }), ...undos];
    }
    default:
      return [verb("do", value.kind === "ask" ? "Ask" : "Set up an agent…", value, { key: "↩" })];
  }
}
