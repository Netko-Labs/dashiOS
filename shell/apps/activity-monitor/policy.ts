/**
 * Which processes Activity Monitor may quit: only the user's own, never
 * init, and never the processes it runs under (the shell, the compositor,
 * the session; force-quit's `protectedPids`), whose end would end the
 * session. Everyone else's are shown, read-only.
 */

import type { ProcessRow } from "./sample.ts";

export type QuitSignal = "SIGTERM" | "SIGKILL";

/** Why `row` can't be quit, or null when it can. */
export function quitRefusal(row: Pick<ProcessRow, "pid" | "own" | "kernel">, protectedPids: ReadonlySet<number>): string | null {
  if (!Number.isInteger(row.pid) || row.pid <= 1) return "It is the system's own process.";
  if (row.kernel) return "It is part of the kernel.";
  if (!row.own) return "It belongs to another user.";
  if (protectedPids.has(row.pid)) return "Your session runs on it; quitting it would end the session.";
  return null;
}
