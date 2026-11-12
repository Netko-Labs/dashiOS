/**
 * What an agents' row in the launcher does (rows.ts): ask, set an agent up,
 * a "Now" item, a history entry, and the verbs on them (Stop, Undo).
 */

import type { HarnessId, HistoryEntry, NowItem, Undo } from "../../../agents/index.ts";

export type AgentAct =
  /** Send the words to the answerer: the launcher shows the plan. */
  | { kind: "ask"; query: string }
  /** No answerer picked yet: Settings › Agents. */
  | { kind: "set-up" }
  /** A Now row: a "Your turn" brings its window forward, a task shows its plan. */
  | { kind: "now"; item: NowItem }
  | { kind: "stop"; item: NowItem }
  /** A history row: Settings › Agents, where the whole list is. */
  | { kind: "history"; entry: HistoryEntry }
  | { kind: "undo"; entry: string; index: number; undo: Undo }
  /** Start an agent on the words in the background (agents/handoff/): the grants card first, once per kind of task. */
  | { kind: "hand-off"; harness: HarnessId; query: string; watch?: boolean }
  /** A harness that isn't signed in: Terminal, to sign in. */
  | { kind: "sign-in-harness"; harness: HarnessId }
  /** A run from the launcher: its card in the menu bar's panel. */
  | { kind: "run"; run: string }
  | { kind: "stop-run"; run: string }
  /** Words to a run (⇥ on its row): the field takes them. */
  | { kind: "tell"; run: string };
