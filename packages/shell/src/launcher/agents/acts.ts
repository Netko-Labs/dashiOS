/**
 * What an agents' row in the launcher does (rows.ts): ask, set an agent up,
 * a "Now" item, a history entry, and the verbs on them (Stop, Undo).
 */

import type { HistoryEntry } from "../../agents/ask/history.ts";
import type { NowItem } from "../../agents/ask/now.ts";
import type { Undo } from "../../agents/ask/plan.ts";

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
  | { kind: "undo"; entry: string; index: number; undo: Undo };
