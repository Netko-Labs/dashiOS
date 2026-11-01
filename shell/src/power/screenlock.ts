/**
 * Locking the screen ahead of a sleep: start the lock screen, then wait for
 * the compositor to say the session is locked, and a moment more for the
 * lock screen's first frame to reach the panel, so waking up never shows the
 * desktop. Waiting has a cap: a lock screen that will not come up must not
 * keep the machine awake (logind lets a delay lock hold sleep back for 5 s by
 * default, and then sleeps regardless).
 */

import { type Clock, systemClock, wait } from "./clock.ts";
import type { LockWatch } from "./lockwatch.ts";
import type { PowerSettings } from "./settings.ts";

/** The longest the lock is waited for. Under logind's own limit (InhibitDelayMaxSec, 5 s). */
export const LOCK_CAP_MS = 2000;
/** After the lock is up, long enough for the lock screen to draw. */
export const SETTLE_MS = 250;

export interface ScreenLockDeps {
  /** Starts the lock screen; null without a compositor, and nothing is locked then. */
  lock: (() => void) | null;
  watch: LockWatch;
  settings(): PowerSettings;
  clock?: Clock;
  capMs?: number;
  settleMs?: number;
}

export class ScreenLock {
  constructor(private readonly deps: ScreenLockDeps) {}

  /** Whether the lock screen can be raised at all. */
  get available(): boolean {
    return this.deps.lock !== null;
  }

  /**
   * Locks the screen if the person wants that before sleep. Resolves true when
   * the session is locked and drawn, false when it was not asked for or did
   * not come up in time.
   */
  async lockAndWait(): Promise<boolean> {
    const { lock, watch, settings, clock = systemClock, capMs = LOCK_CAP_MS, settleMs = SETTLE_MS } = this.deps;
    if (!settings().lockOnSleep || !lock) return false;
    const alreadyLocked = watch.isLocked;
    // Even when locked, this respawns a lock screen that died.
    lock();
    if (alreadyLocked) return true;
    const locked = await watch.whenLocked(capMs);
    if (locked) await wait(clock, settleMs);
    return locked;
  }
}
