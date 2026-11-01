/**
 * The power key. logind would act on it at once (power off, by default); the
 * shell holds a `handle-power-key` block lock so that nothing happens until
 * the person has been asked, and a short press opens the shut down sheet.
 * The key itself reaches the shell as the keymap's `XF86PowerOff` binding
 * (keymap.ts), which the compositor reports like any other.
 *
 * While the lock is held, a long press does nothing either (logind's long
 * press action is inhibited with the short one); holding the button for a few
 * seconds powers a laptop off in firmware, without logind.
 */

import type { HeldLock } from "./inhibit.ts";
import { sayOnce } from "./log.ts";

export const POWER_KEY_LOCK = {
  what: "handle-power-key",
  who: "Dashi",
  why: "Ask before shutting down",
  mode: "block",
} as const;

/** A held key repeats; presses this close together are one. */
export const REPEAT_MS = 700;

export interface PowerKeyDeps {
  take(): Promise<HeldLock>;
  /** Opens the shut down sheet. */
  confirm(): void;
  /** Keys do not act on a locked session. */
  isLocked(): boolean;
  now?: () => number;
}

export class PowerKey {
  private held: HeldLock | null = null;
  private closed = false;
  private lastPress = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: PowerKeyDeps) {}

  /** Takes over the key from logind; the shell keeps it until it exits. */
  async hold(): Promise<void> {
    try {
      const lock = await this.deps.take();
      if (this.closed) lock.release();
      else this.held = lock;
    } catch (error) {
      sayOnce("power-key-lock", "cannot take over the power key, so logind keeps handling it", error);
    }
  }

  /** The key was pressed. */
  press(): void {
    const now = (this.deps.now ?? (() => performance.now()))();
    const repeat = now - this.lastPress < REPEAT_MS;
    this.lastPress = now;
    if (repeat || this.deps.isLocked()) return;
    this.deps.confirm();
  }

  close(): void {
    this.closed = true;
    const held = this.held;
    this.held = null;
    held?.release();
  }
}
