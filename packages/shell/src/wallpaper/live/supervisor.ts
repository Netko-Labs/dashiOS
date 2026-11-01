/**
 * One external wallpaper renderer (linux-wallpaperengine) kept running for
 * one screen. Bun owns the process:
 *
 *   - it is started when wanted and stopped (SIGTERM, then SIGKILL) when not;
 *   - while paused it is stopped with SIGSTOP and costs nothing, and SIGCONT
 *     brings it back where it was; a renderer that is wanted while paused
 *     is not started until the pause lifts;
 *   - when it dies on its own it is started again after a growing wait, and
 *     after too many quick deaths it is given up on, quietly: the still
 *     wallpaper under it was there all along.
 *
 * The spawner and the clock are passed in, so the rules are tested with a
 * fake of each.
 */

import { dirname } from "node:path";

export interface Child {
  pid: number;
  /** Resolves with the exit code (null when a signal ended it). */
  exited: Promise<number | null>;
  kill(signal: "SIGTERM" | "SIGKILL" | "SIGSTOP" | "SIGCONT"): void;
  /** The tail of what it wrote to stderr, for the log. */
  tail(): string;
}

export type Spawner = (argv: readonly string[]) => Child;

export interface Clock {
  now(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type SupervisorState = "idle" | "running" | "paused" | "waiting" | "gave-up";

export interface SupervisorOptions {
  argv: readonly string[];
  spawn: Spawner;
  clock?: Clock;
  /** Waits before each restart, in order; the last repeats. */
  backoffMs?: readonly number[];
  /** Quick deaths in a row after which it is given up on. */
  maxQuickDeaths?: number;
  /** A run at least this long was healthy: the count starts over. */
  healthyMs?: number;
  /** How long SIGTERM gets before SIGKILL. */
  graceMs?: number;
  log?: (message: string) => void;
  /** It was given up on. */
  onGiveUp?: (reason: string) => void;
}

export const BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000] as const;

export class Supervisor {
  private readonly clock: Clock;
  private readonly backoff: readonly number[];
  private readonly maxQuick: number;
  private readonly healthyMs: number;
  private readonly graceMs: number;
  private child: Child | null = null;
  private startedAt = 0;
  private quickDeaths = 0;
  private wanted = false;
  private isPaused = false;
  private timer: unknown = null;
  private gaveUp = false;
  /** Tells a deliberate stop from a death, so only the latter restarts. */
  private generation = 0;

  constructor(private readonly options: SupervisorOptions) {
    this.clock = options.clock ?? realClock;
    this.backoff = options.backoffMs ?? BACKOFF_MS;
    this.maxQuick = options.maxQuickDeaths ?? 5;
    this.healthyMs = options.healthyMs ?? 30_000;
    this.graceMs = options.graceMs ?? 2000;
  }

  get state(): SupervisorState {
    if (this.gaveUp) return "gave-up";
    if (this.child !== null) return this.isPaused ? "paused" : "running";
    return this.timer !== null ? "waiting" : "idle";
  }

  get pid(): number | null {
    return this.child?.pid ?? null;
  }

  /** Run the renderer (once started, again after a pause lifts or it dies). */
  start(): void {
    this.wanted = true;
    this.gaveUp = false;
    this.quickDeaths = 0;
    this.launch();
  }

  /** Stop it, and wait until it is gone. */
  async stop(): Promise<void> {
    this.wanted = false;
    this.cancelTimer();
    const child = this.child;
    if (child === null) return;
    this.generation++;
    this.child = null;
    const waited = child.exited.catch(() => null);
    try {
      // A stopped process does not hear SIGTERM until it continues.
      if (this.isPaused) child.kill("SIGCONT");
      child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
    let timer: unknown = null;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = this.clock.setTimeout(() => resolve("timeout"), this.graceMs);
    });
    const outcome = await Promise.race([waited, timedOut]);
    if (timer !== null) this.clock.clearTimeout(timer);
    if (outcome === "timeout") {
      try {
        child.kill("SIGKILL");
      } catch {
        // Gone between the two.
      }
      await waited;
    }
  }

  /** Kill it now, without waiting: for the shell's exit, which must not leave a renderer behind. */
  killNow(): void {
    this.wanted = false;
    this.cancelTimer();
    try {
      this.child?.kill("SIGKILL");
    } catch {
      // Gone already.
    }
  }

  pause(): void {
    if (this.isPaused) return;
    this.isPaused = true;
    this.signal("SIGSTOP");
  }

  resume(): void {
    if (!this.isPaused) return;
    this.isPaused = false;
    if (this.child !== null) this.signal("SIGCONT");
    else if (this.wanted && !this.gaveUp && this.timer === null) this.launch();
  }

  private signal(signal: "SIGSTOP" | "SIGCONT"): void {
    try {
      this.child?.kill(signal);
    } catch {
      // It died; its exit is being handled.
    }
  }

  private launch(): void {
    if (!this.wanted || this.child !== null || this.isPaused || this.gaveUp) return;
    let child: Child;
    this.startedAt = this.clock.now();
    try {
      child = this.options.spawn(this.options.argv);
    } catch (error) {
      this.died(`could not start: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    this.child = child;
    const generation = ++this.generation;
    void child.exited.then(
      (code) => this.exited(generation, child, `exited with ${code ?? "a signal"}`),
      (error: unknown) => this.exited(generation, child, `failed: ${error instanceof Error ? error.message : String(error)}`),
    );
  }

  private exited(generation: number, child: Child, how: string): void {
    // A deliberate stop (or a replacement) already moved on.
    if (generation !== this.generation || this.child !== child) return;
    this.child = null;
    const tail = child.tail().trim().split("\n").slice(-3).join(" | ");
    this.died(`${how}${tail === "" ? "" : ` (${tail})`}`);
  }

  private died(why: string): void {
    if (this.clock.now() - this.startedAt >= this.healthyMs) this.quickDeaths = 0;
    this.quickDeaths++;
    this.options.log?.(`the wallpaper renderer ${why}`);
    if (this.quickDeaths >= this.maxQuick) {
      this.gaveUp = true;
      this.options.onGiveUp?.(why);
      return;
    }
    if (!this.wanted) return;
    const wait = this.backoff[Math.min(this.quickDeaths - 1, this.backoff.length - 1)] ?? 1000;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.launch();
    }, wait);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }
}

/** Starts real processes: a renderer that dies with the shell (PR_SET_PDEATHSIG through setpriv when there is one). */
export function bunSpawner(): Spawner {
  return (argv) => {
    const guard = Bun.which("setpriv");
    const command = guard ? [guard, "--pdeathsig", "KILL", "--", ...argv] : [...argv];
    // From the renderer's own folder, where it keeps its shaders and data.
    const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "pipe", cwd: dirname(argv[0] ?? "/") });
    let tail = "";
    void (async () => {
      try {
        for await (const chunk of child.stderr) tail = (tail + new TextDecoder().decode(chunk)).slice(-2000);
      } catch {
        // The pipe closed with the process.
      }
    })();
    return {
      pid: child.pid,
      exited: child.exited.then((code) => (child.signalCode ? null : code)),
      kill: (signal) => child.kill(signal),
      tail: () => tail,
    };
  };
}
