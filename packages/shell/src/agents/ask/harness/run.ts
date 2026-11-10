/**
 * Running a harness for one turn, in Dashi's agent sandbox (dashi-agent, in
 * plan mode: sandbox.ts `PlanProfile`), with the environment it needs and
 * nothing else of the session's: no keys or tokens of other providers, no
 * display, no Dashi socket but the turn's plan socket.
 */

import { join } from "node:path";
import { planSocketInside } from "../../sandbox.ts";
import type { HarnessSpec } from "./catalog.ts";

/** A program started for a turn: what it prints, how it ends, and how to stop it. */
export interface Running {
  /** Its pid (dashi-agent's: its scope is named after it). */
  readonly pid: number | null;
  /** All it printed on stdout, once it ends. */
  readonly stdout: Promise<string>;
  /** Its exit code; null when a signal ended it. */
  readonly exited: Promise<number | null>;
  /** Stop it and everything it started. */
  stop(): void;
}

export type Runner = (argv: readonly string[], options: { env: Record<string, string>; stdin: string }) => Running;

/** The session's variables a harness keeps: who and where it is, its language, and the folders it is told of. */
const KEPT = /^(?:HOME|USER|LOGNAME|PATH|SHELL|LANG|LANGUAGE|LC_[A-Z]+|TZ|XDG_RUNTIME_DIR|XDG_(?:CONFIG|DATA|STATE|CACHE)_HOME|CLAUDE_CONFIG_DIR|CODEX_HOME)$/;
/** What dashi-agent needs outside its sandbox (systemd-run reaches the user manager over the bus; bwrap and Bun where to find them). */
const FOR_DASHI_AGENT = /^(?:DBUS_SESSION_BUS_ADDRESS|DASHI_BUN|DASHI_AGENT_BWRAP)$/;

/** The environment a harness's turn starts with: the session's kept variables, the harness's own, and the turn's. */
export function harnessEnv(
  spec: Pick<HarnessSpec, "passEnv">,
  session: Readonly<Record<string, string | undefined>>,
  add: Readonly<Record<string, string>>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(session)) {
    if (value === undefined) continue;
    if (KEPT.test(name) || FOR_DASHI_AGENT.test(name) || spec.passEnv?.test(name)) env[name] = value;
  }
  return { ...env, TERM: "dumb", NO_COLOR: "1", ...add };
}

/** Where the shell's own pieces are: Bun, the MCP bridge, dashi-agent (installed or in a checkout, next to this file). */
export interface ShellPaths {
  bun: string;
  bridge: string;
  dashiAgent: string;
}

export const shellPaths = (): ShellPaths => {
  const bin = join(import.meta.dir, "../../../../bin");
  return { bun: process.execPath, bridge: join(bin, "dashi-mcp.ts"), dashiAgent: join(bin, "dashi-agent.ts") };
};

/** The bridge as the harness starts it inside the sandbox: Bun, dashi-mcp, and the plan socket where the sandbox has it. */
/** The bridge as a harness's sandbox starts it: its command, arguments and environment. */
export interface BridgeInside {
  command: string;
  args: string[];
  env: { DASHI_MCP_SOCKET: string };
}

export const bridgeInside = (paths: ShellPaths, runtime: string): BridgeInside => ({
  command: paths.bun,
  args: [paths.bridge],
  env: { DASHI_MCP_SOCKET: planSocketInside(runtime) },
});

/** How long a stopped harness has to end before its scope is stopped. */
const STOP_GRACE_MS = 3_000;

/** The runner for the session: Bun.spawn, and a stop that reaches the scope if SIGTERM isn't enough. */
export function hostRunner(scopeOf: (pid: number) => string): Runner {
  return (argv, { env, stdin }) => {
    const child = Bun.spawn([...argv], { env, stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "ignore" });
    const stdout = new Response(child.stdout).text();
    let stopped = false;
    return {
      pid: child.pid,
      stdout,
      exited: child.exited.then((code) => (child.signalCode ? null : code)),
      stop() {
        if (stopped) return;
        stopped = true;
        child.kill("SIGTERM");
        const timer = setTimeout(() => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGKILL");
          Bun.spawn(["systemctl", "--user", "stop", scopeOf(child.pid)], { stdio: ["ignore", "ignore", "ignore"] });
        }, STOP_GRACE_MS);
        void child.exited.then(() => clearTimeout(timer));
      },
    };
  };
}
