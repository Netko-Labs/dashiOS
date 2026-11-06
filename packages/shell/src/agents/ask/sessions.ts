/**
 * An agent's connections, as the history lists them. An agent that connects
 * once per call (a remote agent driving Dashi over SSH, a script) left a
 * column of "Remote agent · 1 call" rows; connections of the same agent that
 * follow each other closely are one row instead: every call counted, the
 * time they span, and each connection kept (`parts`) for Settings to list
 * when the row is opened. The launcher's "history" reads the same rows.
 */

import type { HistoryEntry } from "./history.ts";

/** Connections of one agent this close (seconds from one's last call to the next one's first) are one row. */
export const SESSION_GAP_S = 10 * 60;

/** "40 s" is no span; "4 min", "1 h", "2 h 5 min". */
export function spanWords(seconds: number): string | null {
  if (seconds < 60) return null;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

/** An agent's row in one line: "12 calls over 4 min: list windows, screenshot, click" (the first three kinds of call). */
export function callsSummary(tools: readonly string[], start: number, end: number): string {
  const count = tools.length === 1 ? "1 call" : `${tools.length} calls`;
  const span = spanWords(end - start);
  const named = [...new Set(tools)].slice(0, 3).join(", ");
  return `${count}${span ? ` over ${span}` : ""}: ${named}`;
}

const isSession = (entry: HistoryEntry): boolean => entry.tools !== undefined;

/**
 * `entries`, oldest first, with each run of one agent's connections that
 * follow each other within `SESSION_GAP_S` (nothing else between them) as
 * one row. A connection on its own stays as it was.
 */
export function groupSessions(entries: readonly HistoryEntry[], gap: number = SESSION_GAP_S): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (const entry of entries) {
    const last = out.at(-1);
    const joins = last !== undefined && isSession(last) && isSession(entry) && last.who === entry.who && entry.time - (last.end ?? last.time) <= gap;
    if (!joins) {
      out.push(entry);
      continue;
    }
    const group: HistoryEntry = last.parts ? last : { ...last, id: `${last.id}+`, tools: [...(last.tools ?? [])], parts: [last] };
    group.parts?.push(entry);
    group.tools?.push(...(entry.tools ?? []));
    group.end = Math.max(group.end ?? group.time, entry.end ?? entry.time);
    group.open = entry.open === true;
    group.summary = callsSummary(group.tools ?? [], group.time, group.end);
    out[out.length - 1] = group;
  }
  return out;
}
