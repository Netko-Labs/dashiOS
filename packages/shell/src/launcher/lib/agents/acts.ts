/**
 * What an agents' row in the launcher does (rows.ts): ask, set an agent up,
 * a "Now" item, a history entry, and the verbs on them (Stop, Undo).
 */

import type { HistoryEntry, NowItem, Undo } from "../../../agents/index.ts";

export type AgentAct =
  /** Send the words to Dashi's agent: the launcher becomes the conversation (lib/talk/). */
  | { kind: "ask"; query: string }
  /** No answerer picked yet: Settings › Agents. */
  | { kind: "set-up" }
  /** A Now row: a "Your turn" brings its window forward; Stop stops it. */
  | { kind: "now"; item: NowItem }
  | { kind: "stop"; item: NowItem }
  /** A history row: Settings › Agents, where the whole list is. */
  | { kind: "history"; entry: HistoryEntry }
  | { kind: "undo"; entry: string; index: number; undo: Undo };
