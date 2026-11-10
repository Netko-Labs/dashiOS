/**
 * The OS side of Force Quit and Activity Monitor's Quit: sending a signal,
 * asking whether a process is still there, reading a process's /proc entry,
 * and the processes never to signal (protectedPids). The policy in policy.ts
 * decides what gets these calls.
 */

import { readFileSync } from "node:fs";
import type { Signal, SignalResult } from "./policy.ts";

const codeOf = (error: unknown): string => (typeof error === "object" && error !== null && "code" in error ? String(error.code) : "");

/** process.kill with the outcomes the policy tells apart. */
export function sendSignal(pid: number, signal: Signal): SignalResult {
  try {
    process.kill(pid, signal);
    return "sent";
  } catch (error) {
    return codeOf(error) === "ESRCH" ? "gone" : "denied";
  }
}

/** Signal 0 checks that the process exists. A process we may not signal still exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return codeOf(error) !== "ESRCH";
  }
}

/** /proc/<pid>/stat, or null when the process cannot be read. */
export function readProcStat(pid: number): string | null {
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    return null;
  }
}

/** `pid (comm) S ppid …` from /proc/<pid>/stat; comm may hold spaces and parentheses. */
export function statParent(text: string): { comm: string; ppid: number } | null {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return null;
  const rest = text
    .slice(close + 1)
    .trim()
    .split(" ");
  const ppid = Number(rest[1]);
  return Number.isInteger(ppid) && ppid >= 0 ? { comm: text.slice(open + 1, close), ppid } : null;
}

/** Parents followed up to init; a session's process tree is a handful deep. */
const MAX_DEPTH = 64;

/**
 * The shell's own process and every process above it (its parents up to
 * init): the compositor it runs under, the session, and a terminal a nested
 * run was started from. Never listed, never signalled. `readStat` returns
 * /proc/<pid>/stat, or null when it cannot be read.
 */
export function protectedPids(self: number, readStat: (pid: number) => string | null): ReadonlySet<number> {
  const protectedSet = new Set<number>([0, 1, self]);
  let pid = self;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth++) {
    const stat = statParent(readStat(pid) ?? "");
    if (!stat) break;
    protectedSet.add(stat.ppid);
    pid = stat.ppid;
  }
  return protectedSet;
}
