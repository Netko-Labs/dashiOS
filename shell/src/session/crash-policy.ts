/**
 * When a crashed session service may start again, and when to stop trying.
 * Pure: the caller supplies the clock, so the schedule is testable.
 */

/** Waits before restart number 1, 2, 3, ...; the last one repeats. */
export const BACKOFF_MS: readonly number[] = [500, 1_000, 2_000, 4_000];

/** This many crashes inside {@link CRASH_WINDOW_MS} and the service is given up on. */
export const GIVE_UP_AFTER = 5;

export const CRASH_WINDOW_MS = 60_000;

export type CrashVerdict =
  | { kind: "restart"; delayMs: number; /** Crashes inside the window, this one included. */ crashes: number }
  | { kind: "give-up"; crashes: number };

export interface CrashPolicyOptions {
  backoffMs?: readonly number[];
  giveUpAfter?: number;
  windowMs?: number;
}

export class CrashPolicy {
  private readonly times: number[] = [];
  private readonly backoffMs: readonly number[];
  private readonly giveUpAfter: number;
  private readonly windowMs: number;

  constructor(options: CrashPolicyOptions = {}) {
    this.backoffMs = options.backoffMs?.length ? options.backoffMs : BACKOFF_MS;
    this.giveUpAfter = options.giveUpAfter ?? GIVE_UP_AFTER;
    this.windowMs = options.windowMs ?? CRASH_WINDOW_MS;
  }

  /**
   * Note a crash at `now` (milliseconds, any monotonic clock) and say what to
   * do. Crashes older than the window are forgotten, so a service that ran
   * well for a minute starts over at the shortest wait.
   */
  record(now: number): CrashVerdict {
    while (this.times.length > 0 && now - (this.times[0] ?? now) >= this.windowMs) this.times.shift();
    this.times.push(now);
    const crashes = this.times.length;
    if (crashes >= this.giveUpAfter) return { kind: "give-up", crashes };
    const step = Math.min(crashes, this.backoffMs.length) - 1;
    return { kind: "restart", delayMs: this.backoffMs[step] ?? this.backoffMs.at(-1) ?? 0, crashes };
  }
}
