/**
 * The notification center's history: what it keeps of each notification,
 * how a closed one is marked, and how far back it goes (`MAX_HISTORY`). The
 * store (store.ts) holds the list; these return the next version of it.
 */

import type { HistoryEntry, Notification } from "./types.ts";

export const MAX_HISTORY = 200;

/**
 * The history with `notification` recorded: it replaces an older entry with
 * the same id, a transient one is not kept, and past the cap the oldest
 * closed entry goes (else the oldest).
 */
export function recordInHistory(history: readonly HistoryEntry[], notification: Notification): HistoryEntry[] {
  const next = history.filter((entry) => entry.id !== notification.id);
  if (notification.transient) return next;
  next.push({ ...notification });
  if (next.length > MAX_HISTORY) {
    const closed = next.findIndex((entry) => entry.closed);
    next.splice(closed >= 0 ? closed : 0, 1);
  }
  return next;
}

/** The history with the open entry for `id` marked closed; unchanged in content if there is none open. */
export function markClosed(history: readonly HistoryEntry[], id: number, closed: NonNullable<HistoryEntry["closed"]>): HistoryEntry[] {
  const found = history.findIndex((past) => past.id === id && !past.closed);
  if (found < 0) return [...history];
  return history.map((entry, at) => (at === found ? { ...entry, closed } : entry));
}
