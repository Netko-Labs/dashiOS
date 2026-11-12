/**
 * Force Quit Applications as data: which apps the window lists (one row per
 * process that has a window), in what order, and where the selection and the
 * scroll position sit. Pure, so it is tested without a compositor.
 */

import type { CompositorWindow } from "../../compositor/index.ts";
import type { AppGroup } from "../types.ts";

export interface Identity {
  name: string;
  icon: string;
}

/** Rows the list shows at once; the rest scroll into view with the arrow keys. */
export const VISIBLE_ROWS = 6;

/**
 * The apps with windows, one row per process, sorted by name and then pid
 * (two processes of one app are two rows). Windows without a process id
 * cannot be signalled, so they are left out, as are protected processes.
 */
export function appGroups(
  windows: readonly CompositorWindow[],
  protectedSet: ReadonlySet<number>,
  identify: (window: CompositorWindow) => Identity,
): AppGroup[] {
  const byPid = new Map<number, { first: CompositorWindow; count: number }>();
  for (const window of windows) {
    const pid = window.pid;
    if (pid === null || protectedSet.has(pid)) continue;
    const seen = byPid.get(pid);
    if (seen) seen.count++;
    else byPid.set(pid, { first: window, count: 1 });
  }
  const rows = [...byPid].map(([pid, { first, count }]) => {
    const { name, icon } = identify(first);
    return { pid, appId: first.appId, name, icon, windowCount: count, title: first.title.trim() };
  });
  const sharing = new Map<string, number>();
  for (const row of rows) sharing.set(row.name, (sharing.get(row.name) ?? 0) + 1);
  return rows
    .map(({ title, ...row }): AppGroup => ({ ...row, detail: (sharing.get(row.name) ?? 0) > 1 ? title : "" }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.pid - b.pid);
}

/** The row index of `pid`, or -1 when it is not listed (or null). */
export function indexOfPid(groups: readonly AppGroup[], pid: number | null): number {
  return pid === null ? -1 : groups.findIndex((group) => group.pid === pid);
}

/** The selection after a refresh: the same app if it is still listed, else the first row. */
export function keepSelection(groups: readonly AppGroup[], selected: number | null): number | null {
  if (indexOfPid(groups, selected) >= 0) return selected;
  return groups[0]?.pid ?? null;
}

/** One row up or down from `selected` (the first row when nothing is selected). The list does not wrap. */
export function moveSelection(groups: readonly AppGroup[], selected: number | null, direction: "up" | "down"): number | null {
  if (groups.length === 0) return null;
  const index = indexOfPid(groups, selected);
  if (index < 0) return groups[0]?.pid ?? null;
  const next = Math.min(Math.max(index + (direction === "down" ? 1 : -1), 0), groups.length - 1);
  return groups[next]?.pid ?? null;
}

/**
 * The first visible row after the selection moves to `index` (-1: nothing
 * selected). The list moves only when the selected row would be off it.
 */
export function revealTop(top: number, index: number, count: number, rows: number = VISIBLE_ROWS): number {
  const last = Math.max(0, count - rows);
  let next = Math.min(Math.max(top, 0), last);
  if (index < 0) return next;
  if (index < next) next = index;
  else if (index >= next + rows) next = index - rows + 1;
  return Math.min(Math.max(next, 0), last);
}
