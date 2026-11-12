/**
 * Which processes Activity Monitor may quit: only the user's own, never
 * init, and never the processes it runs under (the shell, the compositor,
 * the session; force-quit's `protectedPids`), whose end would end the
 * session. Everyone else's are shown, read-only. Quitting an app quits the
 * processes it was started as (lines.ts `appRoots`); its helpers follow.
 *
 * A signal goes to the process that was shown: the pid and the moment it
 * started are checked again just before it is sent (main.tsx), so a pid
 * reused while the sheet was open is never signalled.
 */

import type { ProcessRow } from "./sample.ts";

export type QuitSignal = "SIGTERM" | "SIGKILL";

/** A process to signal, as it was shown. */
export type Target = Pick<ProcessRow, "pid" | "starttime" | "name">;

/** How long a quit app has to end before Activity Monitor offers to force quit it. */
export const STILL_RUNNING_MS = 3000;

export interface Guard {
  /** The shell, the compositor, the session, and Activity Monitor itself. */
  protectedPids: ReadonlySet<number>;
  /** Activity Monitor's own process. */
  self: number;
}

/** Why `row` can't be quit, or null when it can. */
export function quitRefusal(row: Pick<ProcessRow, "pid" | "own" | "kernel">, guard: Guard): string | null {
  if (!Number.isInteger(row.pid) || row.pid <= 1) return "It is the system’s own process.";
  if (row.kernel) return "It is part of the kernel.";
  if (row.pid === guard.self) return "Use ❖Q to quit Activity Monitor.";
  if (!row.own) return "It belongs to another user.";
  if (guard.protectedPids.has(row.pid)) return "Your session runs on it. Quitting it would end the session.";
  return null;
}

/** Why none of `rows` may be quit (the first reason), or null when all may. */
export function quitRefusalAll(rows: readonly Pick<ProcessRow, "pid" | "own" | "kernel">[], guard: Guard): string | null {
  if (rows.length === 0) return "It has already ended.";
  for (const row of rows) {
    const reason = quitRefusal(row, guard);
    if (reason) return reason;
  }
  return null;
}
