/**
 * Locking before sleep, the way macOS does. The shell holds a logind "delay"
 * inhibitor on `sleep`; when logind announces `PrepareForSleep(true)` (the
 * lid, the Sleep row, `systemctl suspend`, a sleep key) the machine waits for
 * the lock to be released, so the shell raises the lock screen first, waits
 * for it, and lets go. `PrepareForSleep(false)` is the machine waking up:
 * the lock is taken again for the next sleep, and the compositor is told to
 * reset its screens (KMS state can change across a suspend on real hardware).
 *
 * Sleep must never wait on us for long: the wait is capped (screenlock.ts),
 * and the lock is released whatever happened while locking.
 */

import type { HeldLock } from "./inhibit.ts";
import { sayOnce } from "./log.ts";
import type { ScreenLock } from "./screenlock.ts";

export const SLEEP_LOCK = {
  what: "sleep",
  who: "Dashi",
  why: "Lock the screen before sleeping",
  mode: "delay",
} as const;

export interface SleepGuardDeps {
  /** Takes the delay lock. */
  take(): Promise<HeldLock>;
  screen: ScreenLock;
  /** Runs once the machine is awake and the lock is retaken (resetting the screens). */
  woke?(): Promise<void> | void;
}

export class SleepGuard {
  private held: HeldLock | null = null;
  private taking: Promise<void> | null = null;
  /** Bumped by every announcement, so a slow lock cannot release what a wake-up retook. */
  private generation = 0;
  private closed = false;

  constructor(private readonly deps: SleepGuardDeps) {}

  /** Whether sleep currently waits for us. */
  get holding(): boolean {
    return this.held !== null;
  }

  /** Takes the delay lock unless it is held; never rejects. */
  acquire(): Promise<void> {
    if (this.held || this.closed) return Promise.resolve();
    this.taking ??= this.take().finally(() => {
      this.taking = null;
    });
    return this.taking;
  }

  /** `PrepareForSleep`. */
  async prepare(sleeping: boolean): Promise<void> {
    const generation = ++this.generation;
    if (!sleeping) {
      await this.acquire();
      try {
        await this.deps.woke?.();
      } catch (error) {
        sayOnce("wake", "waking the screens failed", error);
      }
      return;
    }
    try {
      await this.deps.screen.lockAndWait();
    } catch (error) {
      sayOnce("lock-before-sleep", "locking before sleep failed", error);
    }
    // Woken (or the sleep was called off) while locking: the lock stays.
    if (generation === this.generation) this.release();
  }

  close(): void {
    this.closed = true;
    this.generation++;
    this.release();
  }

  private release(): void {
    const held = this.held;
    this.held = null;
    held?.release();
  }

  private async take(): Promise<void> {
    try {
      const lock = await this.deps.take();
      if (this.closed || this.held) lock.release();
      else this.held = lock;
    } catch (error) {
      sayOnce("sleep-lock", "cannot hold a sleep lock, so the screen locks only when asked to", error);
    }
  }
}
