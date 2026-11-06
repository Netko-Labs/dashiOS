/**
 * Ending the shell, and ending the machine.
 *
 * The shell: every closer runs on its own, so one that throws cannot skip
 * the rest or the `process.exit` that follows. The session supervisor counts
 * a shell that hangs half-closed as a crash.
 *
 * The machine (Restart, Shut Down): the apps get 10 seconds to close, then
 * logind is asked to restart or power off whatever is still running. A
 * process stuck in a driver (Steam on a graphics card that fell off the bus,
 * 2026-11-04) can't be killed at all, so waiting for it is waiting forever:
 * it is told to go, killed at the deadline, and left behind. After a few
 * seconds Dashi says who it is waiting for. The system's own stop timeouts
 * (dashi-release's systemd drop-ins) cap what systemd waits after that.
 */

import { readFileSync } from "node:fs";
import { type MachineAction, powerMachine } from "./power/machine.ts";

export type Closer = readonly [name: string, close: () => void];

/** Runs each closer in order; a throw is logged and the next one still runs. Returns the names that threw. */
export function runClosers(closers: readonly Closer[], log: (message: string, error: unknown) => void = console.error): string[] {
  const failed: string[] = [];
  for (const [name, close] of closers) {
    try {
      close();
    } catch (error) {
      failed.push(name);
      log(`dashi-shell: closing ${name} failed:`, error);
    }
  }
  return failed;
}

/** How long apps get before the machine goes anyway. */
export const GRACE_MS = 10_000;
/** After this long Dashi says what it is waiting for. */
export const SAY_AFTER_MS = 3000;
const POLL_MS = 250;

export interface AppProcess {
  pid: number;
  name: string;
}

export interface MachineEndDeps {
  /** The apps to close (the windows' processes), the shell's own left out. */
  processes(): Promise<AppProcess[]>;
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  isAlive(pid: number): boolean;
  machine(what: "restart" | "shutdown"): Promise<void>;
  /** Some apps haven't closed: their names and the seconds until the machine goes without them. */
  waiting?(names: readonly string[], seconds: number, what: "restart" | "shutdown"): void;
  sleep?(ms: number): Promise<void>;
  now?(): number;
  graceMs?: number;
}

/** Closes the apps, gives them `graceMs`, then restarts or powers off regardless. Returns the names left behind. */
export async function endMachine(what: "restart" | "shutdown", deps: MachineEndDeps): Promise<string[]> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const grace = deps.graceMs ?? GRACE_MS;
  const apps = await deps.processes().catch(() => []);
  const tell = (pid: number, signal: "SIGTERM" | "SIGKILL") => {
    try {
      deps.signal(pid, signal);
    } catch {
      // Gone already, or not ours.
    }
  };
  for (const app of apps) tell(app.pid, "SIGTERM");
  const started = now();
  let said = false;
  let left = apps.filter((app) => deps.isAlive(app.pid));
  while (left.length > 0 && now() - started < grace) {
    await sleep(POLL_MS);
    left = left.filter((app) => deps.isAlive(app.pid));
    if (!said && left.length > 0 && now() - started >= SAY_AFTER_MS) {
      said = true;
      deps.waiting?.([...new Set(left.map((app) => app.name))], Math.max(1, Math.round((grace - (now() - started)) / 1000)), what);
    }
  }
  for (const app of left) tell(app.pid, "SIGKILL");
  await deps.machine(what);
  return [...new Set(left.map((app) => app.name))];
}

/** What the shell hands in at startup: where the apps are, and how to say who it is waiting for. */
let configured: Pick<MachineEndDeps, "processes" | "waiting"> | null = null;

export function configureMachineEnd(deps: Pick<MachineEndDeps, "processes" | "waiting">): void {
  configured = deps;
}

const isAlive = (pid: number): boolean => {
  try {
    // A zombie has exited; only its parent's wait is missing.
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return !/^\d+ \(.*\) Z /s.test(stat);
  } catch {
    return false;
  }
};

/** The menus' power action: sleep at once; restart and shut down after the apps had their time (endMachine). */
export async function powerAfterApps(what: MachineAction): Promise<void> {
  if (what === "sleep" || !configured) return powerMachine(what);
  const deps = configured;
  await endMachine(what, {
    processes: deps.processes,
    ...(deps.waiting ? { waiting: deps.waiting } : {}),
    signal: (pid, signal) => process.kill(pid, signal),
    isAlive,
    machine: (action) => powerMachine(action),
  });
}
