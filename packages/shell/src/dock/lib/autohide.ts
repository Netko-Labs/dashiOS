/**
 * When an autohiding Dock is out: the pointer reaching the screen's bottom
 * edge brings it, the pointer being away from the edge and the Dock for a
 * moment sends it back. Two things keep it out besides the pointer: a drag
 * of an icon (the pointer may leave the Dock's area with the button down)
 * and an icon's menu being open (it sits on a surface of its own, over the
 * Dock's area). With autohide off the Dock is simply there.
 *
 * This is the whole policy as a small state machine over timers. Where the
 * pointer is comes from the compositor (dock/lib/edges.ts: a client is never
 * told that the pointer left its surface); dock/presenter.ts shows what
 * `revealed` says.
 */

export const AUTOHIDE = {
  /** The pointer must rest at the edge this long before the Dock comes (a brush past the edge does nothing). */
  revealMs: 120,
  /** The pointer must be away this long before the Dock goes (a slip off the Dock's top does not hide it). */
  hideMs: 600,
} as const;

export interface AutohideClock {
  /** Runs `fn` after `ms`; returns the way to cancel it. */
  later(fn: () => void, ms: number): () => void;
}

const realClock: AutohideClock = {
  later(fn, ms) {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  },
};

export class Autohide {
  private enabled = false;
  /** The pointer is in the band the compositor watches: the screen's bottom edge, and the Dock's own area while it is out. */
  private near = false;
  /** Holds, by name: a drag and a menu can overlap. */
  private readonly holds = new Set<string>();
  private out = false;
  private cancel: (() => void) | null = null;
  private readonly listeners = new Set<(revealed: boolean) => void>();

  constructor(
    private readonly clock: AutohideClock = realClock,
    private readonly delays: { revealMs: number; hideMs: number } = AUTOHIDE,
  ) {}

  /** Whether the Dock is out. Meaningful only while autohide is on; otherwise the Dock is always shown. */
  get revealed(): boolean {
    return this.out;
  }

  subscribe(listener: (revealed: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Autohide turned on (the Dock then goes unless the pointer is near) or off. */
  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.drop();
    this.set(false);
    this.settle();
  }

  /** The pointer entered or left the band along the screen's bottom edge (edges.ts). */
  edge(inside: boolean): void {
    this.near = inside;
    this.settle();
  }

  /** Something keeps the Dock out until it lets go (`hold(name, false)`). */
  hold(name: string, on: boolean): void {
    if (on) this.holds.add(name);
    else this.holds.delete(name);
    this.settle();
  }

  close(): void {
    this.drop();
    this.listeners.clear();
  }

  private get wanted(): boolean {
    return this.near || this.holds.size > 0;
  }

  /** Aim for the state the pointer asks for, after the delay, unless that is where it already is. */
  private settle(): void {
    if (!this.enabled) return;
    const want = this.wanted;
    if (want === this.out) return this.drop();
    // A wait for the same change is already running; the pointer coming back cancels the other.
    if (this.cancel && this.pending === want) return;
    this.drop();
    this.pending = want;
    this.cancel = this.clock.later(
      () => {
        this.cancel = null;
        this.set(want);
      },
      want ? this.delays.revealMs : this.delays.hideMs,
    );
  }

  private pending = false;

  private drop(): void {
    this.cancel?.();
    this.cancel = null;
  }

  private set(revealed: boolean): void {
    if (this.out === revealed) return;
    this.out = revealed;
    for (const listener of this.listeners) listener(revealed);
  }
}
