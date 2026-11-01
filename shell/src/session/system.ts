/** The real process, clock, and log behind {@link ServiceDeps}. */

import type { ExitInfo, RunningChild, ServiceDeps, ServiceSpec } from "./service.ts";

export function log(message: string): void {
  // stdout and stderr are the same file (dashi-session redirects both).
  console.error(`${new Date().toISOString()} dashi-session: ${message}`);
}

function spawn(spec: ServiceSpec): RunningChild {
  const child = Bun.spawn([...spec.cmd], {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    // setsid(): its own process group, so everything it starts can be reaped.
    detached: true,
  });
  return {
    pid: child.pid,
    exited: child.exited.then((code): ExitInfo => {
      const signal = child.signalCode;
      return signal ? { code: null, signal: String(signal) } : { code, signal: null };
    }),
  };
}

/** Signal a process or group; false when there was nothing (left) to signal. */
function signal(pid: number, name: "SIGTERM" | "SIGKILL"): boolean {
  try {
    process.kill(pid, name);
    return true;
  } catch {
    // ESRCH: already gone. EPERM cannot happen for our own children.
    return false;
  }
}

export const systemDeps: ServiceDeps = {
  spawn,
  signal,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => performance.now(),
  log,
};
