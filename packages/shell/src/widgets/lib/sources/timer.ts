/**
 * Dashi's timers: start, pause, add a minute, stop. A running timer is live
 * (on air as "running", a capsule in the bar); at zero it is due: it holds
 * the tally at most two minutes, rings as a notification "Tea is ready", and
 * waits in its card until stopped. Times come from a clock passed in, so the
 * rules are tested without waiting.
 */

import type { OnAirItem } from "../../../tally/index.ts";
import { Source } from "./source.ts";

export interface Timer {
  id: string;
  label: string;
  /** The whole length, in ms (for the progress row). */
  total: number;
  /** When it reaches zero (ms), while it runs. */
  endsAt: number | null;
  /** What was left when paused (ms). */
  left: number | null;
  /** When it started or last changed state, for the tally's "newest". */
  since: number;
}

export interface TimerClock {
  now(): number;
  at(at: number, run: () => void): () => void;
}

const REAL: TimerClock = {
  now: () => Date.now(),
  at: (at, run) => {
    const handle = setTimeout(run, Math.max(0, at - Date.now()));
    return () => clearTimeout(handle);
  },
};

/** What is left of a timer at `now`, in ms. */
export function timeLeft(timer: Timer, now: number): number {
  return timer.endsAt === null ? (timer.left ?? 0) : Math.max(0, timer.endsAt - now);
}

export class Timers extends Source<readonly Timer[]> {
  private n = 0;
  private readonly rings = new Map<string, () => void>();

  constructor(
    private readonly onRing: (timer: Timer) => void = () => {},
    private readonly clock: TimerClock = REAL,
  ) {
    super([]);
  }

  start(label: string, minutes: number): Timer {
    const now = this.clock.now();
    const total = Math.round(minutes * 60_000);
    const timer: Timer = { id: `t${++this.n}`, label: label.trim() || "Timer", total, endsAt: now + total, left: null, since: now };
    this.put([...this.getSnapshot(), timer]);
    return timer;
  }

  pause(id: string): void {
    const now = this.clock.now();
    this.change(id, (timer) => (timer.endsAt === null ? timer : { ...timer, left: timeLeft(timer, now), endsAt: null, since: now }));
  }

  resume(id: string): void {
    const now = this.clock.now();
    this.change(id, (timer) => (timer.endsAt !== null ? timer : { ...timer, endsAt: now + (timer.left ?? 0), left: null, since: now }));
  }

  addMinute(id: string): void {
    const now = this.clock.now();
    this.change(id, (timer) => {
      const left = timeLeft(timer, now) + 60_000;
      return timer.endsAt === null ? { ...timer, left, total: timer.total + 60_000 } : { ...timer, endsAt: now + left, total: Math.max(timer.total, left), since: now };
    });
  }

  stop(id: string): void {
    this.put(this.getSnapshot().filter((timer) => timer.id !== id));
  }

  /** The timers as the tally sees them: running, or due once at zero. */
  onAir(now: number = this.clock.now()): OnAirItem[] {
    return this.getSnapshot().map((timer) => {
      const done = timer.endsAt !== null && timer.endsAt <= now;
      const base = { key: `timer:${timer.id}`, label: timer.label, glyph: "timer", ink: "wakame" as const };
      if (done) return { ...base, reason: "due", since: timer.endsAt ?? now, deadline: timer.endsAt ?? now };
      return { ...base, reason: "running", since: timer.since, ...(timer.endsAt === null ? {} : { countdown: timer.endsAt }) };
    });
  }

  private change(id: string, edit: (timer: Timer) => Timer): void {
    this.put(this.getSnapshot().map((timer) => (timer.id === id ? edit(timer) : timer)));
  }

  private put(timers: Timer[]): void {
    for (const [id, cancel] of this.rings) {
      if (timers.some((timer) => timer.id === id && timer.endsAt !== null)) continue;
      cancel();
      this.rings.delete(id);
    }
    for (const timer of timers) {
      if (timer.endsAt === null) continue;
      this.rings.get(timer.id)?.();
      const ends = timer.endsAt;
      this.rings.set(
        timer.id,
        this.clock.at(ends, () => {
          this.rings.delete(timer.id);
          // A new snapshot, so the area and the tally see it reach zero.
          this.set([...this.getSnapshot()]);
          this.onRing(timer);
        }),
      );
    }
    this.set(timers);
  }
}
