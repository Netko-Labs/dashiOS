/**
 * Whether the screen is locked, as the compositor tells it: a `lock` event
 * at every change (after `subscribe`), and the `session` request for how
 * things stand when the shell starts. While it is locked agents get nothing
 * and nobody is asked anything (docs/agents.html, "Locked means stopped").
 */

import type { Compositor } from "../compositor.ts";

/** What a tool call is told while the screen is locked. */
export const LOCKED = "The screen is locked. Nothing on the desktop can be seen or done until the person unlocks it.";
/** …and one that was already running when the screen locked. */
export const LOCKED_WHILE_RUNNING = "The screen locked while this ran, so what it did or saw is not reported. Check again once the person has unlocked it.";

export class LockWatch {
  /** Locked until the compositor says otherwise: unknown is not a reason to let agents in. */
  private locked = true;
  private readonly listeners = new Set<(locked: boolean) => void>();
  private readonly stop: () => void;

  constructor(compositor: Pick<Compositor, "on" | "session">) {
    // Events and replies share one ordered stream, so applying both as they
    // arrive leaves the newest state, whichever of them comes first.
    this.stop = compositor.on((event) => {
      if (event.event === "lock") this.set(event.locked);
    });
    compositor
      .session()
      .then((session) => {
        if (session) this.set(session.locked);
        else console.error("dashi-shell: dashi-comp's session answer was not understood; agents stay locked out");
      })
      .catch((error) => console.error("dashi-shell: could not ask whether the screen is locked:", error));
  }

  get isLocked(): boolean {
    return this.locked;
  }

  /** Called when the state changes; returns the function that stops it. */
  onChange(listener: (locked: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.stop();
    this.listeners.clear();
  }

  private set(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked;
    for (const listener of this.listeners) listener(locked);
  }
}
