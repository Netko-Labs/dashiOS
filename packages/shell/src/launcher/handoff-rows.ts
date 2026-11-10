/**
 * Agents from the launcher, as rows (docs/actions.md, "Agents from the
 * launcher"). Pure: the launcher draws them, the tests read them.
 *
 * - Words that read as a task (a verb and three or more words, or five or
 *   more) put "Hand it off" first: one row per installed harness, the one
 *   Settings names first, ⌥1… for the others; "Right now" under it has Ask
 *   (⇥). An app's or a setting's name in the words still finds it first:
 *   the ranking's top row wins, not a mode.
 * - Words that read as a request but not a task get "Hand it off" after
 *   what was found, before Ask.
 * - An empty launcher lists the runs first ("Agents"): ↩ opens the card,
 *   ⇥ talks to it, ❖⌫ stops it.
 */

import { cut, type HandoffHarness, type HarnessId, harnessGlyph, isWorking, progressWords, type RunView, statusWords } from "../agents/index.ts";
import { ASK_ROW, readsLikeSentence } from "./agent-rows.ts";
import { commandCore } from "./ranking/commands.ts";
import { fold } from "./ranking/fold.ts";
import type { Row } from "./row-model.ts";
import type { Section } from "./sections.ts";
import type { HandoffSnapshot } from "./types.ts";
import type { Hint } from "./verbs.ts";

/** Verbs a task starts with, beyond the request verbs Ask knows (rows.ts). */
const TASK_VERBS = new Set(
  "book buy order reserve rename summarize summarise reply email download upload sort plan compare fill pay sign check cancel organize organise clean translate research update fix draft get look read watch call message text post share print save delete archive unsubscribe subscribe find make write send add create schedule remind open set take go use help turn move".split(
    " ",
  ),
);

/** Whether the words read as a task to hand off: a verb and three or more words, or five or more words; not a question. */
export function readsLikeTask(query: string): boolean {
  const text = query.trim();
  if (text.endsWith("?")) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length >= 5) return true;
  return words.length >= 3 && TASK_VERBS.has(fold(words[0] ?? ""));
}

/** Rows that name a thing (an app, a setting, a window, a command), not files or answers. */
const namesAThing = (row: Row): boolean =>
  row.action.kind !== "open-file" && row.id !== "answer" && !row.id.startsWith("search-") && !row.id.startsWith("find-");

/**
 * Whether the ranking found the thing the words name: its top row's name is
 * in the words ("turn on dark mode now please" finds Dark Mode), the words
 * begin its name ("visual studio co" finds Visual Studio Code), or the words
 * are a short command and the ranking found what it names ("set volume to
 * 30" finds Output volume by its keyword: ranking/commands.ts).
 */
export function namesFound(query: string, sections: readonly Section[]): boolean {
  const words = ` ${fold(query.trim())} `;
  const top = sections.flatMap((section) => section.rows).find(namesAThing);
  if (!top) return false;
  if (commandCore(query) !== null && top.action.kind !== "agent") return true;
  const name = fold(top.title.trim());
  if (name.length < 3) return false;
  return words.includes(` ${name} `) || name.startsWith(fold(query.trim()));
}

export const HANDOFF_ROW = "handoff:";

/** "Start Claude Code": Return starts it (after the card, the first time). */
export function handoffRow(harness: HandoffHarness, index: number, query: string): Row {
  const signedOut = harness.signedIn === false;
  return {
    id: `${HANDOFF_ROW}${harness.id}`,
    title: `Start ${harness.name}`,
    detail: signedOut ? "isn't signed in · Return opens Terminal" : index === 0 ? "works in the background · signs in through Dashi" : harness.uses,
    kind: "",
    ...(index > 0 && index < 10 ? { shortcut: `⌥${index}` } : {}),
    icon: { glyph: harnessGlyph(harness.id) },
    agent: "ask",
    action: {
      kind: "agent",
      act: signedOut ? { kind: "sign-in-harness", harness: harness.id } : { kind: "hand-off", harness: harness.id, query: query.trim() },
    },
  };
}

/** The Ask row in "Right now", beside "Hand it off": what it is, and its key. */
export function askNowRow(ask: Row): Row {
  return { ...ask, title: "Ask", detail: "a plan of a few steps you approve with one Return", kind: "", shortcut: "⇥" };
}

/** A run on the empty launcher: its words, what it does, how far along; amber while it needs the person. */
export function runRow(run: RunView): Row {
  return {
    id: `run:${run.id}`,
    title: cut(run.request, 44),
    detail: statusWords(run),
    kind: isWorking(run) && !run.question ? progressWords(run) : "",
    icon: { glyph: harnessGlyph(run.harness) },
    agent: "dot",
    ...(isWorking(run) ? { stop: true as const } : {}),
    ...(run.question ? { attention: true as const } : {}),
    action: { kind: "agent", act: { kind: "run", run: run.id } },
  };
}

/** Runs an empty launcher lists at most, so Recent keeps its place. */
export const RUN_ROWS = 3;

/** The runs to list: the ones waiting on the person, then working, then those ended in the last hour; newest first in each. */
export function runsToList(runs: readonly RunView[]): RunView[] {
  const rank = (run: RunView) => (run.question ? 0 : isWorking(run) ? 1 : 2);
  return [...runs].sort((a, b) => rank(a) - rank(b) || b.started - a.started).slice(0, RUN_ROWS);
}

export interface HandoffRowsInput {
  query: string;
  allApps: boolean;
  snapshot: HandoffSnapshot | null;
  /** ⇥ was pressed: Ask, not a hand-off. */
  tabbed: boolean;
}

/**
 * The launcher's sections with hand-off's added: "Agents" on top of an
 * empty field, "Hand it off" first for a task (Ask then under "Right
 * now"), or after what was found for a request.
 */
export function withHandoff(sections: readonly Section[], input: HandoffRowsInput): Section[] {
  const snapshot = input.snapshot;
  const query = input.query.trim();
  if (!snapshot) return [...sections];
  if (!query) {
    const runs = runsToList(snapshot.runs);
    if (input.allApps || runs.length === 0) return [...sections];
    return [{ id: "agents", title: "Agents", rows: runs.map(runRow) }, ...sections];
  }
  if (snapshot.harnesses.length === 0 || input.tabbed || !readsLikeSentence(query)) return [...sections];
  const handoff: Section = { id: "handoff", title: "Hand it off", rows: snapshot.harnesses.map((harness, index) => handoffRow(harness, index, query)) };
  const ask = sections.find((section) => section.id === "ask");
  const rest = sections.filter((section) => section !== ask);
  if (readsLikeTask(query) && !namesFound(query, rest)) {
    const now: Section[] = ask ? [{ id: "ask", title: "Right now", rows: ask.rows.map((row) => (row.id === ASK_ROW ? askNowRow(row) : row)) }] : [];
    // A nothing-found section has nothing to say when the words are a task.
    return [handoff, ...now, ...rest.filter((section) => section.id !== "nothing")];
  }
  return [...rest, handoff, ...(ask ? [ask] : [])];
}

/** The harness ⌥digit picks among the rows ("Start Codex" is ⌥1 when Claude Code is first). */
export function harnessByDigit(snapshot: HandoffSnapshot | null, digit: number): HarnessId | null {
  return snapshot?.harnesses[digit]?.id ?? null;
}

/** The hints at the field's right end for a hand-off row and for a run's row. */
export function handoffHints(row: Row | undefined): Hint[] | null {
  if (row?.action.kind !== "agent") return null;
  const act = row.action.act;
  if (act.kind === "hand-off")
    return [
      { keys: "↩", label: "Start" },
      { keys: "⌥↩", label: "Start and watch" },
      { keys: "⇥", label: "Ask instead" },
    ];
  if (act.kind === "run")
    return [{ keys: "↩", label: "Open" }, { keys: "⇥", label: "Tell it something" }, ...(row.stop ? [{ keys: "❖⌫", label: "Stop" }] : [])];
  return null;
}

/** Whether the launcher shows the context chips: words that read as a request, while a hand-off or Ask (`asks`) is offered. */
export const showsContext = (query: string, snapshot: HandoffSnapshot | null, asks = false): boolean =>
  ((snapshot !== null && snapshot.harnesses.length > 0) || asks) && readsLikeSentence(query.trim());
