/**
 * One supervised session service: start it, and when it dies without being
 * asked to, start it again after a pause, until it keeps crashing.
 *
 * Every service runs in a session and process group of its own, so a crash
 * can take the service's helpers with it: the shell's Metal hosts only stop
 * updating when Bun dies (they exit when their surface closes, not on EOF),
 * and a restarted shell would stack a second Dock over the first.
 */

import { CrashPolicy, type CrashPolicyOptions } from "./crash-policy.ts";

export interface ServiceSpec {
  name: string;
  cmd: readonly string[];
  cwd?: string;
  env?: Readonly<Record<string, string>>;
  /** The session is not worth having without it: giving up ends the session. */
  essential?: boolean;
}

export interface ExitInfo {
  code: number | null;
  signal: string | null;
}

export interface RunningChild {
  pid: number;
  exited: Promise<ExitInfo>;
}

export interface ServiceDeps {
  /** Start the service as the leader of a new process group. */
  spawn(spec: ServiceSpec): RunningChild;
  /** Signal a process (pid > 0) or a whole group (pid < 0); false when nothing was there. */
  signal(pid: number, signal: "SIGTERM" | "SIGKILL"): boolean;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(message: string): void;
}

export interface ServiceOptions extends CrashPolicyOptions {
  /** How long a stopping service gets to quit before it is killed. */
  stopGraceMs?: number;
  /** How long a dead service's leftovers get to quit before they are killed. */
  reapGraceMs?: number;
}

export type ServiceEnd = "stopped" | "gave-up";

export function describeExit(exit: ExitInfo): string {
  if (exit.signal) return `killed by ${exit.signal}`;
  return `exit code ${exit.code ?? "unknown"}`;
}

export class Service {
  private readonly policy: CrashPolicy;
  private readonly stopGraceMs: number;
  private readonly reapGraceMs: number;
  private stopping = false;
  private child: RunningChild | null = null;
  private cancelPause: (() => void) | null = null;
  private finished: Promise<ServiceEnd> | null = null;

  constructor(
    readonly spec: ServiceSpec,
    private readonly deps: ServiceDeps,
    options: ServiceOptions = {},
  ) {
    this.policy = new CrashPolicy(options);
    this.stopGraceMs = options.stopGraceMs ?? 3_000;
    this.reapGraceMs = options.reapGraceMs ?? 300;
  }

  /** Run until stopped or given up on. Resolves with which. */
  start(): Promise<ServiceEnd> {
    this.finished ??= this.supervise();
    return this.finished;
  }

  /** Ask the service to quit (SIGTERM), then kill it if it will not. */
  async stop(): Promise<void> {
    this.stopping = true;
    this.cancelPause?.();
    const child = this.child;
    if (child) {
      this.deps.signal(child.pid, "SIGTERM");
      void this.deps.sleep(this.stopGraceMs).then(() => {
        if (this.child === child) this.deps.signal(-child.pid, "SIGKILL");
      });
    }
    await this.finished;
  }

  private async supervise(): Promise<ServiceEnd> {
    const { name } = this.spec;
    while (!this.stopping) {
      const startedAt = this.deps.now();
      let child: RunningChild;
      try {
        child = this.deps.spawn(this.spec);
      } catch (error) {
        this.deps.log(`${name}: could not start: ${error}`);
        if ((await this.afterCrash()) === "gave-up") return "gave-up";
        continue;
      }
      this.child = child;
      this.deps.log(`${name}: started (pid ${child.pid})`);
      const exit = await child.exited;
      await this.reap(child.pid);
      this.child = null;
      if (this.stopping) {
        this.deps.log(`${name}: stopped (${describeExit(exit)})`);
        return "stopped";
      }
      const seconds = ((this.deps.now() - startedAt) / 1000).toFixed(1);
      this.deps.log(`${name}: exited on its own (${describeExit(exit)}) after ${seconds}s`);
      if ((await this.afterCrash()) === "gave-up") return "gave-up";
    }
    return "stopped";
  }

  /** Decide, and wait out the pause before the next start. */
  private async afterCrash(): Promise<ServiceEnd | "restart"> {
    const { name } = this.spec;
    const verdict = this.policy.record(this.deps.now());
    if (verdict.kind === "give-up") {
      this.deps.log(`${name}: GIVING UP: ${verdict.crashes} crashes within a minute. ` + `It will not be restarted again; read the lines above for why.`);
      return "gave-up";
    }
    this.deps.log(`${name}: crash ${verdict.crashes}; restarting in ${verdict.delayMs} ms`);
    await this.pause(verdict.delayMs);
    return "restart";
  }

  /** Sleep, unless stop() cuts it short. */
  private async pause(ms: number): Promise<void> {
    if (this.stopping) return;
    const woken = new Promise<void>((resolve) => (this.cancelPause = resolve));
    await Promise.race([this.deps.sleep(ms), woken]);
    this.cancelPause = null;
  }

  /** Whatever the service left running in its group goes with it. */
  private async reap(leader: number): Promise<void> {
    if (!this.deps.signal(-leader, "SIGTERM")) return;
    await this.deps.sleep(this.reapGraceMs);
    this.deps.signal(-leader, "SIGKILL");
  }
}
