/**
 * Whether the session is locked, as the compositor says: its `session`
 * answer at the start and its `lock` events after. Sleeping waits on this
 * (the lock has to be up before the machine goes down) and logind's lock
 * hint follows it.
 */

import type { Compositor } from "../compositor.ts";
import { type Clock, systemClock } from "./clock.ts";

export class LockWatch {
  private locked = false;
  private listeners = new Set<(locked: boolean) => void>();

  constructor(private readonly clock: Clock = systemClock) {}

  get isLocked(): boolean {
    return this.locked;
  }

  /** The state changed (the compositor's `lock` event, or a test). */
  set(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked;
    for (const listener of [...this.listeners]) listener(locked);
  }

  onChange(listener: (locked: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Resolves true once the session is locked (at once if it is), false after `ms` if it is not. */
  whenLocked(ms: number): Promise<boolean> {
    if (this.locked) return Promise.resolve(true);
    return new Promise((resolve) => {
      let cancel = () => {};
      const stop = this.onChange((locked) => {
        if (!locked) return;
        stop();
        cancel();
        resolve(true);
      });
      cancel = this.clock.after(ms, () => {
        stop();
        resolve(false);
      });
    });
  }

  /** Follow the compositor; returns the function that stops. */
  async follow(compositor: Pick<Compositor, "on" | "request">): Promise<() => void> {
    let heard = false;
    const stop = compositor.on((event) => {
      if (event.event !== "lock") return;
      heard = true;
      this.set(event.locked);
    });
    const session = await compositor.request("session").catch(() => null);
    // An event that came while the answer was on its way is newer than the answer.
    if (!heard && typeof session === "object" && session !== null) this.set((session as { locked?: unknown }).locked === true);
    return stop;
  }
}
