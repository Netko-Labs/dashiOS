/**
 * Keeps what the graphics notices need between changes: the mode last said,
 * when the mode last moved and why, when the last notice went up, and
 * whether the "waiting for apps" notice is up. The controller (controller.ts)
 * tells it each switch; it asks `decideNotice` (notice.ts) what to say, and
 * asks again later when that says to wait.
 */

import type { Later } from "../display-config/steady.ts";
import { decideNotice, type GraphicsNotice, type GraphicsWhy } from "./notice.ts";
import type { GraphicsMode } from "./policy.ts";

export interface TellerDeps {
  /** Posts the notice in graphics notices' one place (it replaces the last one). */
  say(notice: GraphicsNotice): void;
  /** Takes the waiting notice down: the wait ended without a switch. */
  withdraw(): void;
  /** The built-in screen's rate for this power source, when Automatic moves it ("60 Hz"); else null. */
  rate?(plugged: boolean): string | null;
  now?(): number;
  later?: Later;
}

const later: Later = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export class GraphicsTeller {
  private told: GraphicsMode | null = null;
  private mode: GraphicsMode | null = null;
  private why: GraphicsWhy = "chosen";
  private changedAt = 0;
  private noticeAt: number | null = null;
  private waiting = false;
  private waitedFor: readonly string[] = [];
  private cancel: (() => void) | null = null;

  constructor(
    private readonly card: boolean,
    private readonly deps: TellerDeps,
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The mode Dashi is in once its first decision is made: later changes are said against it. */
  started(mode: GraphicsMode | null): void {
    this.mode = mode;
    this.told = mode;
  }

  /** The waiting notice went up, in the same place. */
  waitingSaid(names: readonly string[]): void {
    this.waiting = true;
    this.waitedFor = [...names];
    this.noticeAt = this.now();
  }

  /**
   * The mode moved to `mode` (or, with "failed", didn't), or a wait ended
   * without a switch (the same mode again). `waitedFor` names the apps a
   * "waited" switch waited for.
   */
  changed(mode: GraphicsMode | null, why: GraphicsWhy, waitedFor: readonly string[] = []): void {
    if (why !== "failed") {
      if (mode !== this.mode) this.changedAt = this.now();
      this.mode = mode;
      this.why = why;
      if (waitedFor.length > 0) this.waitedFor = [...waitedFor];
      // Before the first decision there is nothing to say a change against; the person's own pick is known to them.
      if (this.told === null || why === "chosen") this.told = mode;
    }
    this.ask(why === "failed" ? "failed" : this.why);
  }

  close(): void {
    this.cancel?.();
    this.cancel = null;
  }

  private ask(why: GraphicsWhy): void {
    this.close();
    const now = this.now();
    const rate = why === "unplugged" || why === "plugged" ? (this.deps.rate?.(why === "plugged") ?? null) : null;
    const decision = decideNotice({
      card: this.card,
      before: this.told,
      after: this.mode,
      why,
      held: now - this.changedAt,
      sinceNotice: this.noticeAt === null ? null : now - this.noticeAt,
      waiting: this.waiting,
      waitedFor: this.waitedFor,
      rate,
    });
    if (decision.say === "later") {
      this.cancel = (this.deps.later ?? later)(() => {
        this.cancel = null;
        this.ask(this.why);
      }, decision.ms);
      return;
    }
    if (decision.say === "nothing") {
      if (decision.withdraw && this.waiting) this.deps.withdraw();
      if (decision.withdraw) this.waiting = false;
      return;
    }
    this.deps.say(decision.notice);
    this.told = this.mode;
    this.noticeAt = now;
    this.waiting = false;
    this.waitedFor = [];
  }
}
