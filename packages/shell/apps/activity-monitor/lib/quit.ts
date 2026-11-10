/**
 * Quitting a line, as data: what it signals (an app's root processes, or the
 * process), whether it may, and what happened. The view asks first on a
 * sheet; `sendQuit` checks again at the moment of sending (the line may be
 * stale by a refresh) and the signal itself checks that the pid is still the
 * process that was shown (main.tsx).
 */

import { appRoots, type Line } from "./lines.ts";
import { type Guard, type QuitSignal, quitRefusalAll, type Target } from "./policy.ts";
import type { ProcessRow } from "./sample.ts";

export interface QuitActions {
  /** Sends `signal` to the process shown, if it is still that process; what happened. */
  signal(target: Target, signal: QuitSignal): "sent" | "gone" | "denied";
  /** Whether the process shown is still running (and not a zombie). */
  alive(target: Target): boolean;
  guard: Guard;
}

/**
 * The processes quitting `line` signals: for an app, the processes it was
 * started as, among all of its processes (`rows`, whatever the search shows;
 * its helpers end with them); for a process, itself.
 */
export function quitTargets(line: Line, rows: readonly ProcessRow[]): ProcessRow[] {
  const key = line.kind === "app" ? line.members[0]?.app?.key : undefined;
  if (key !== undefined) return appRoots(rows.filter((row) => row.app?.key === key && !row.kernel));
  return line.process ? [line.process] : [];
}

/** Why `line` can't be quit, or null. */
export function lineRefusal(line: Line, rows: readonly ProcessRow[], guard: Guard): string | null {
  return quitRefusalAll(quitTargets(line, rows), guard);
}

export type QuitOutcome = { kind: "refused"; reason: string } | { kind: "sent"; targets: Target[] } | { kind: "gone" };

/** Signals `line`'s processes, unless one of them may not be. */
export function sendQuit(line: Line, rows: readonly ProcessRow[], signal: QuitSignal, actions: QuitActions): QuitOutcome {
  const targets = quitTargets(line, rows);
  const reason = quitRefusalAll(targets, actions.guard);
  if (reason) return { kind: "refused", reason };
  const results = targets.map((target) => ({ target, result: actions.signal(target, signal) }));
  if (results.some(({ result }) => result === "denied")) return { kind: "refused", reason: "The system refused to quit it." };
  const sent = results.filter(({ result }) => result === "sent").map(({ target }) => target);
  return sent.length > 0 ? { kind: "sent", targets: sent } : { kind: "gone" };
}
