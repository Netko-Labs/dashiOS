/** The launcher's one snapshot of its agents, made again only when something under it changed; and its history, read at most every few seconds. */

import type { LauncherAgentsSnapshot } from "../../../launcher/agents/rows.ts";
import type { Turn } from "../../presence.ts";
import { type AnswererChoice, answererOf } from "../answerer.ts";
import type { HistoryEntry, HistoryLog } from "../history.ts";
import { nowItems } from "../now.ts";
import type { AskOptions } from "../types.ts";
import type { AskTasks } from "./tasks.ts";

/** How long a read of the history stands for the launcher's keystrokes ("history" re-renders on each). */
const HISTORY_FRESH_MS = 3_000;

export function launcherSnapshot(options: AskOptions, tasks: AskTasks): () => LauncherAgentsSnapshot {
  let seen: { choice: AnswererChoice | undefined; tasks: unknown; turns: readonly Turn[]; agents: unknown } | null = null;
  let snapshot: LauncherAgentsSnapshot = { answerer: null, unset: true, now: [], tasks: [] };
  return () => {
    const now = {
      choice: options.settings.getSnapshot().data.agents.answerer,
      tasks: tasks.getSnapshot(),
      turns: options.turns.getSnapshot(),
      agents: options.agents.getSnapshot(),
    };
    if (seen && seen.choice === now.choice && seen.tasks === now.tasks && seen.turns === now.turns && seen.agents === now.agents) return snapshot;
    seen = now;
    snapshot = {
      answerer: answererOf(now.choice),
      unset: now.choice === undefined,
      now: nowItems({ turns: now.turns, tasks: now.tasks, agents: options.agents.getSnapshot() }),
      tasks: now.tasks,
    };
    return snapshot;
  };
}

/** The history's entries, read again only after it changed or `HISTORY_FRESH_MS` went by. */
export function cachedHistory(history: HistoryLog): { read(): readonly HistoryEntry[]; off(): void } {
  let read: { at: number; entries: readonly HistoryEntry[] } | null = null;
  const off = history.subscribe(() => {
    read = null;
  });
  return {
    read() {
      if (read && Date.now() - read.at < HISTORY_FRESH_MS) return read.entries;
      read = { at: Date.now(), entries: history.read() };
      return read.entries;
    },
    off,
  };
}
