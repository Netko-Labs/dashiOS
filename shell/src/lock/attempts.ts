/**
 * Password tries for the lock screen: one at a time, and after repeated
 * misses the next has to wait (backoffMs). The rule lives here, not in the
 * screen, so typing and pressing Enter fast can't get extra guesses through
 * while a check or a wait is under way.
 */

import { backoffMs } from "./auth.ts";

export type Verdict = "right" | "wrong" | "busy" | "wait";

export class Attempts {
  private misses = 0;
  private notBefore = 0;
  private busy = false;

  constructor(
    private readonly check: (password: string) => Promise<boolean>,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds until the next try is allowed. */
  waitMs(): number {
    return Math.max(0, this.notBefore - this.now());
  }

  /** "busy" while another try runs, "wait" during a backoff, else the check's verdict. */
  async try(password: string): Promise<Verdict> {
    if (this.busy) return "busy";
    if (this.waitMs() > 0) return "wait";
    this.busy = true;
    try {
      if (await this.check(password)) {
        this.misses = 0;
        this.notBefore = 0;
        return "right";
      }
      this.misses += 1;
      this.notBefore = this.now() + backoffMs(this.misses);
      return "wrong";
    } finally {
      this.busy = false;
    }
  }
}
