/**
 * What the shell does when the user has been away: blank the screens after
 * `idle.blankAfterSeconds` (settings.ts) and bring them back on the next
 * input. dashi-comp keeps the clock (real input only; an inhibiting video
 * or presentation holds it back) and tells us over IPC; blanking is its
 * `power` method. Sleeping after `idle.sleepAfterSeconds` is a second
 * threshold whose action is the shell's (`onSleep`, power/).
 *
 * While an app holds the screen awake (inhibit/: a video through the portal
 * or org.freedesktop.ScreenSaver), the thresholds pass without blanking or
 * sleeping. When the holds go, each threshold that passed is counted again
 * from then: a film that ends leaves the screen on for the full wait.
 *
 * Tolerant of an older compositor: if `power` or `idle` is unknown, say so
 * once and carry on.
 */

import type { CompositorEvent } from "./compositor.ts";

/** What apps hold (inhibit/store.ts): the screens may not blank; the computer may not sleep. */
export interface IdleHolds {
  screen(): boolean;
  sleep(): boolean;
}

/** The compositor client's side that the policy uses (and a test fakes). */
export interface IdleHost {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(listener: (event: CompositorEvent) => void): () => void;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class IdlePolicy {
  private seconds = 0;
  private sleepSeconds = 0;
  private blanked = false;
  private readonly stopListening: () => void;
  private readonly warned = new Set<string>();
  /** Told when the screens go off and come back, for what should not run behind a blank screen (live wallpapers). */
  onBlanked: ((blanked: boolean) => void) | null = null;
  /** Told when the person has been away for the sleep threshold; the shell puts the computer to sleep (power/). */
  onSleep: (() => void) | null = null;
  private holds: IdleHolds = { screen: () => false, sleep: () => false };
  /** Thresholds that passed while held, and the timers that count them again after the holds went. */
  private readonly passed = new Set<number>();
  private readonly again = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly host: IdleHost) {
    this.stopListening = host.on((event) => this.hear(event));
  }

  /** Blank after this many idle seconds; 0 never. Safe to call again with a new value. */
  async blankAfter(seconds: number): Promise<void> {
    if (seconds === this.seconds) return;
    this.seconds = seconds;
    // Thresholds are replaced, and a blank screen shouldn't wait on a new one.
    if (this.blanked) await this.power(true);
    await this.register();
  }

  /** Sleep after this many idle seconds; 0 never. Safe to call again with a new value. */
  async sleepAfter(seconds: number): Promise<void> {
    if (seconds === this.sleepSeconds) return;
    this.sleepSeconds = seconds;
    await this.register();
  }

  /** The compositor replaces its thresholds as a set, so both are sent together. */
  private async register(): Promise<void> {
    const timeouts = [...new Set([this.seconds, this.sleepSeconds].filter((seconds) => seconds > 0))];
    try {
      await this.host.request("idle", { timeouts });
    } catch (error) {
      this.complain("idle", error);
    }
  }

  stop(): void {
    this.stopListening();
    this.forgetPassed();
  }

  /** What apps hold; asked each time a threshold passes. */
  holdWith(holds: IdleHolds): void {
    this.holds = holds;
  }

  /** The holds changed: thresholds that passed while held are counted again from now, once nothing holds them. */
  holdsChanged(): void {
    if (this.passed.size === 0 || this.again.size > 0) return;
    if (this.holds.screen()) return;
    for (const seconds of this.passed) {
      const timer = setTimeout(() => {
        this.again.delete(timer);
        this.passed.delete(seconds);
        this.reached(seconds);
      }, seconds * 1000);
      this.again.add(timer);
    }
  }

  private forgetPassed(): void {
    for (const timer of this.again) clearTimeout(timer);
    this.again.clear();
    this.passed.clear();
  }

  private hear(event: CompositorEvent): void {
    if (event.event === "idle") {
      this.reached(event.seconds);
    } else if (event.event === "active") {
      this.forgetPassed();
      if (this.blanked) void this.power(true);
    }
  }

  private reached(seconds: number): void {
    const blank = seconds === this.seconds && seconds > 0;
    const sleep = seconds === this.sleepSeconds && seconds > 0;
    if ((blank && this.holds.screen()) || (sleep && (this.holds.screen() || this.holds.sleep()))) {
      this.passed.add(seconds);
      return;
    }
    if (blank && !this.blanked) void this.power(false);
    if (sleep) this.onSleep?.();
  }

  /** Screens off or on. A compositor without `power` leaves them alone. */
  private async power(on: boolean): Promise<void> {
    this.blanked = !on;
    this.onBlanked?.(!on);
    try {
      await this.host.request("power", { on });
    } catch (error) {
      // The screens didn't go off, whatever the reason.
      if (!on) {
        this.blanked = false;
        this.onBlanked?.(false);
      }
      this.complain("power", error);
    }
  }

  private complain(method: string, error: unknown): void {
    if (this.warned.has(method)) return;
    this.warned.add(method);
    console.error(`dashi-shell: dashi-comp's ${method} failed:`, messageOf(error));
  }
}
