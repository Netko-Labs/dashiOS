/** What a connection shows the menu bar's red dot for (watch-clock.ts keeps the time), and when the dot is published. */

import type { AgentInfo, Watching } from "./presence.ts";
import { WatchClock } from "./watch-clock.ts";

/** How long a finished action stays in the menu bar before "Idle". */
export const SETTLE_MS = 3_000;

export class SessionWatch {
  /** Calls running now that the red dot shows (recording, seeing the screen, its pointer), and since when; one that ended stays as long as its words do (`SETTLE_MS`). */
  private readonly clock = new WatchClock(SETTLE_MS);

  constructor(
    private readonly publish: () => void,
    private readonly closed: () => boolean,
  ) {}

  /** The strongest kind of watching going on now (else the last one, for a moment after it ended), and since when. */
  now(): Pick<AgentInfo, "watching" | "watchingSince"> {
    const watched = this.clock.now(Date.now());
    return watched ? { watching: watched.kind, watchingSince: watched.since } : { watching: null };
  }

  start(kind: Watching | null): void {
    if (!kind) return;
    this.clock.start(kind, Date.now());
    this.publish();
  }

  end(kind: Watching | null): void {
    if (!kind) return;
    this.clock.end(kind, Date.now());
    this.publish();
    // The dot goes once the moment is over, whatever else happens meanwhile.
    setTimeout(() => {
      if (!this.closed()) this.publish();
    }, SETTLE_MS + 50);
  }
}
