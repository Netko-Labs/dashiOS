/**
 * Which processes Force Quit may signal, and in what order: SIGTERM at once,
 * then SIGKILL after a grace period if the process is still there. Pure: the
 * signal, the liveness check, and the timer come in as dependencies (kernel.ts
 * has the real ones), so tests run the whole policy with a fake kill.
 */

export type Signal = "SIGTERM" | "SIGKILL";

/** "gone": no such process. "denied": the kernel refused (not ours to signal). */
export type SignalResult = "sent" | "gone" | "denied";

/** How long an app has to quit after SIGTERM before it is killed. */
export const KILL_GRACE_MS = 2_000;

export interface Targets {
  /** Processes with a window right now, from the compositor's list. */
  listed: ReadonlySet<number>;
  /** The shell and the processes above it (model.ts protectedPids). */
  protected: ReadonlySet<number>;
}

export interface TerminateDeps extends Targets {
  signal(pid: number, signal: Signal): SignalResult;
  alive(pid: number): boolean;
  later(ms: number, run: () => void): void;
}

export type Outcome =
  | { kind: "refused"; reason: string }
  /** SIGTERM went out; SIGKILL follows if the process outlives the grace period. */
  | { kind: "signalled" }
  /** The process was already gone, so nothing was sent. */
  | { kind: "ended" };

/**
 * The checks any signal from Force Quit needs, including the later SIGKILL:
 * a real process id (never 0, never init), and not the shell's own session.
 */
export function killRefusal(pid: number, protectedSet: ReadonlySet<number>): string | null {
  if (!Number.isInteger(pid) || pid <= 1) return "not an app's process";
  if (protectedSet.has(pid)) return "it belongs to the shell or the session";
  return null;
}

/** Why `pid` may not get SIGTERM, or null when it may: it must be a window's process and not protected. */
export function refusal(pid: number, targets: Targets): string | null {
  const unsafe = killRefusal(pid, targets.protected);
  if (unsafe) return unsafe;
  return targets.listed.has(pid) ? null : "it has no window";
}

/** Ends `pid` the way Force Quit does. Nothing is sent when the policy refuses. */
export function terminate(pid: number, deps: TerminateDeps): Outcome {
  const why = refusal(pid, deps);
  if (why) return { kind: "refused", reason: why };
  const first = deps.signal(pid, "SIGTERM");
  if (first === "gone") return { kind: "ended" };
  if (first === "denied") return { kind: "refused", reason: "permission denied" };
  deps.later(KILL_GRACE_MS, () => {
    // The window may already be gone, and a hung app may have none left: only the process matters now.
    if (killRefusal(pid, deps.protected) || !deps.alive(pid)) return;
    deps.signal(pid, "SIGKILL");
  });
  return { kind: "signalled" };
}
