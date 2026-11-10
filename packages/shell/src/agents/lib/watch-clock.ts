/**
 * What an agent's connection is doing that the menu bar's red dot shows
 * (agents/mark.ts `watchingOf`: recording, seeing the screen, its own
 * pointer), and since when. Calls of each kind are counted as they start
 * and end; one that ended lingers `settleMs`, so the dot and its words
 * don't flicker between a run of screenshots, and a call of the same kind
 * starting meanwhile goes on with the time it had (the agents' panel says
 * "Seeing the screen · 2:14", agents-rows.tsx). Pure: the caller says what
 * time it is.
 */

import { strongest } from "../mark.ts";
import type { Watching } from "../presence.ts";

export interface Watched {
  kind: Watching;
  /** When this kind began, without a pause longer than the settle. */
  since: number;
}

export class WatchClock {
  private readonly running = new Map<Watching, number>();
  private readonly from = new Map<Watching, number>();
  private readonly ended = new Map<Watching, number>();

  constructor(private readonly settleMs: number) {}

  /** A call of `kind` started. */
  start(kind: Watching, now: number): void {
    const count = this.running.get(kind) ?? 0;
    if (count === 0 && !this.lingers(kind, now)) this.from.set(kind, now);
    this.running.set(kind, count + 1);
  }

  /** A call of `kind` ended. */
  end(kind: Watching, now: number): void {
    const count = Math.max(0, (this.running.get(kind) ?? 1) - 1);
    this.running.set(kind, count);
    if (count === 0) this.ended.set(kind, now);
  }

  /**
   * The strongest kind going on now and since when; with none going on, the
   * one that ended last, for the settle after it; else null.
   */
  now(now: number): Watched | null {
    let most: Watching | null = null;
    for (const [kind, count] of this.running) if (count > 0) most = strongest(most, kind);
    if (!most) {
      let last = Number.NEGATIVE_INFINITY;
      for (const [kind, at] of this.ended) {
        if (this.lingers(kind, now) && at > last) {
          most = kind;
          last = at;
        }
      }
    }
    return most ? { kind: most, since: this.from.get(most) ?? now } : null;
  }

  private lingers(kind: Watching, now: number): boolean {
    const at = this.ended.get(kind);
    return (this.running.get(kind) ?? 0) === 0 && at !== undefined && now - at < this.settleMs;
  }
}
