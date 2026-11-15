/**
 * Whether a connection is quiet: it has called no tool, or none for a while
 * (decisions.md D136). A connection is not an action: a quiet one is in no
 * menu bar and has no row in the agents' panel, and comes back with its next
 * call. The session says what it holds meanwhile (a call running, a sheet
 * up, the screen seen or recorded, a Desktop of its own, Work alone), which
 * keeps it in sight however long ago it called. The clock and the timers
 * are handed in, so a test never waits.
 */

import { realTimers, type Timers } from "../../../shared/time/index.ts";

/**
 * How long after its last call an agent stays in sight: five minutes. An
 * agent at work thinks between calls for a minute or two at most, so it
 * does not come and go; a chat that is over is gone before the person
 * wonders what it still does.
 */
export const QUIET_AFTER_MS = 5 * 60_000;

/** The wait, or the one `DASHI_AGENTS_QUIET_MS` names (a proof in the VM uses a short one). */
export function quietAfter(env: Record<string, string | undefined> = process.env): number {
  const asked = Number(env.DASHI_AGENTS_QUIET_MS);
  return Number.isFinite(asked) && asked >= 100 ? asked : QUIET_AFTER_MS;
}

export interface QuietClock {
  now?(): number;
  timers?: Timers;
  afterMs?: number;
}

export class SessionQuiet {
  private last: number | null = null;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly afterMs: number;

  constructor(
    /** The wait is over: the lists are made again. */
    private readonly publish: () => void,
    clock: QuietClock = {},
  ) {
    this.now = clock.now ?? Date.now;
    this.timers = clock.timers ?? realTimers;
    this.afterMs = clock.afterMs ?? quietAfter();
  }

  /** When it last called a tool, or a call of it ended (ms); null when it never called. */
  get acted(): number | null {
    return this.last;
  }

  /** A call came in, or one ended: the wait starts again. */
  act(): void {
    this.last = this.now();
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.publish();
    }, this.afterMs + 1);
  }

  /** Quiet now: it holds nothing, and never called or not for the whole wait. */
  quiet(holds: boolean): boolean {
    if (holds) return false;
    return this.last === null || this.now() - this.last >= this.afterMs;
  }

  close(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
}
