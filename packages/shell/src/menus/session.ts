/**
 * Ending the session or the machine: suspend, restart, power off, log out.
 *
 * The machine is only ours in a real session: the shell positively under a
 * dashi-comp that drives the display itself. Inside another desktop (a
 * development window), run by hand with no dashi-comp above it, or under a
 * dashi-comp whose environment cannot be read, the machine is the
 * developer's: sleep, restart, and power off are refused. One test
 * (`isRealSession`) serves every power path, and it fails closed.
 *
 * Suspend, restart, and power off are logind's (`Manager.Suspend`, `Reboot`,
 * `PowerOff` on the system bus, power/machine.ts), not `systemctl`'s; restart
 * and power off give the apps 10 s first, then go regardless (shutdown.ts).
 *
 * Logging out has no compositor IPC yet. On the real display (dashi-comp
 * owns DRM/KMS, started from a login) it ends the login session with
 * `loginctl terminate-session`. When dashi-comp runs inside another desktop
 * (a development window), that session is the developer's own and must not
 * end: only the compositor is stopped, with SIGTERM, found by walking up the
 * shell's parents (the shell is its child, maybe through `sh -c`).
 */

import { readFileSync } from "node:fs";
import type { MachineAction } from "../power/machine.ts";
import { spawnDetached } from "../shared/apps/list.ts";
import { parseStat } from "../shared/processes/kernel.ts";
import { powerAfterApps } from "../shutdown.ts";
import type { PowerKind } from "./model.ts";

export const COMPOSITOR = "dashi-comp";

/** Parents followed before giving up; a session's ancestry is a handful deep. */
const MAX_DEPTH = 16;

/** The nearest ancestor of `start` (itself excluded) whose command is `comm`, or null. */
export function findAncestor(comm: string, start: number, readStat: (pid: number) => string | null): number | null {
  let pid = start;
  for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth++) {
    const stat = parseStat(readStat(pid) ?? "");
    if (!stat) return null;
    if (depth > 0 && stat.comm === comm) return pid;
    pid = stat.ppid;
  }
  return null;
}

/** Whether a process's environment (NUL-separated, /proc/<pid>/environ) says it runs inside another display server. */
export function isNested(environ: string): boolean {
  return environ.split("\0").some((entry) => /^(WAYLAND_DISPLAY|DISPLAY)=./.test(entry));
}

export type LogoutPlan = { kind: "loginctl"; session: string } | { kind: "signal"; pid: number } | { kind: "none" };

/** The dashi-comp above this process (null if none) and whether it runs inside another desktop. */
export interface Above {
  compositor: number | null;
  nested: boolean;
}

/**
 * Whether this shell is positively the session's own: under a dashi-comp that
 * is not nested. Everything that touches the machine (power, logind, the
 * login session) asks this and nothing weaker, so a doubt means no.
 */
export function isRealSession(above: Above): boolean {
  return above.compositor !== null && !above.nested;
}

/** How to log out: see the file's comment. `session` is XDG_SESSION_ID. */
export function planLogout(options: { session: string | undefined } & Above): LogoutPlan {
  const { session, compositor, nested } = options;
  if (compositor === null) return { kind: "none" };
  if (!nested && session && /^[A-Za-z0-9_-]{1,32}$/.test(session)) return { kind: "loginctl", session };
  return { kind: "signal", pid: compositor };
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

/** What a power action does: the machine's command (a real session only), refused otherwise, or log out. */
export function planPower(what: "sleep" | PowerKind, real: boolean): "machine" | "refuse" | "logout" {
  if (what === "logout") return "logout";
  return real ? "machine" : "refuse";
}

/**
 * Runs a power action now (the sheet already asked). `machine` asks logind;
 * it is only called for a real session.
 */
export function runPower(what: "sleep" | PowerKind, above: Above = compositorAbove(), machine: (what: MachineAction) => Promise<void> = powerAfterApps): void {
  const { compositor, nested } = above;
  switch (planPower(what, isRealSession(above))) {
    case "refuse":
      console.error(
        `dashi-shell: not asking logind to ${what}: this is not a Dashi session of its own (nested, run by hand, or dashi-comp unreadable), so this machine is someone's desktop`,
      );
      return;
    case "machine":
      if (what !== "logout") {
        machine(what).catch((error) => console.error(`dashi-shell: logind would not ${what}:`, error instanceof Error ? error.message : error));
      }
      return;
    case "logout":
      break;
  }
  const plan = planLogout({ session: process.env.XDG_SESSION_ID, compositor, nested });
  switch (plan.kind) {
    case "loginctl":
      return spawnDetached(["loginctl", "terminate-session", plan.session]);
    case "signal":
      try {
        process.kill(plan.pid, "SIGTERM");
      } catch (error) {
        console.error("dashi-shell: could not stop the compositor:", error);
      }
      return;
    case "none":
      console.error("dashi-shell: cannot log out: no session id and no compositor above this process");
  }
}

/**
 * The dashi-comp this process runs under (null if none is above it), and
 * whether that one runs inside another desktop. An environment that cannot be
 * read counts as nested: not knowing is not a reason to power the machine off.
 */
export function compositorAbove(read: (path: string) => string | null = readText, start = process.pid): Above {
  const compositor = findAncestor(COMPOSITOR, start, (pid) => read(`/proc/${pid}/stat`));
  if (compositor === null) return { compositor, nested: false };
  const environ = read(`/proc/${compositor}/environ`);
  return { compositor, nested: environ === null || isNested(environ) };
}
