/** The words under an agent's name in the menu bar: what it does now, and "Idle" a moment after it finished. */

import { SETTLE_MS } from "./session-watch.ts";

export class SessionStatus {
  private words = "Connected";
  private serial = 0;

  constructor(
    private readonly publish: () => void,
    /** Whether the words stay as they are: the connection closed, or a sheet is asking the person. */
    private readonly keeps: () => boolean,
  ) {}

  get text(): string {
    return this.words;
  }

  /** What the bar says: at rest, where it works when that is another Desktop ("Working on Desktop 3"). */
  shown(desktop: string | null): string {
    const resting = this.words === "Idle" || this.words === "Connected";
    return desktop !== null && resting ? `Working on ${desktop}` : this.words;
  }

  set(text: string): void {
    this.words = text;
    this.serial++;
    this.publish();
  }

  /** Back to "Connected" without announcing it yet: the caller publishes. */
  reset(): void {
    this.words = "Connected";
  }

  /** An action finished: its words stay a moment, then the pill says "Idle". */
  settle(): void {
    const serial = this.serial;
    setTimeout(() => {
      if (this.serial !== serial || this.keeps()) return;
      this.words = "Idle";
      this.publish();
    }, SETTLE_MS);
  }
}
