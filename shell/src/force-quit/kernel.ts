/**
 * The OS side of Force Quit: sending a signal, asking whether a process is
 * still there, and reading a process's /proc entry (for protectedPids). The
 * policy in policy.ts decides what gets these calls.
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
