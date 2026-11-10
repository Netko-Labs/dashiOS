/**
 * Auto appearance: with `appearance.auto` in settings.json, Dark Mode comes
 * on in the evening and goes off in the morning by itself. There is no
 * location to compute a sunset from (geolocation is not used), so the
 * hours are fixed: dark from 7 PM to 7 AM. The switch is only flipped when
 * the answer changes, so turning Dark Mode on or off by hand in the day
 * lasts until the next change.
 */

import { inSchedule } from "../night-shift.ts";
import type { Flags } from "../shared/control-center/flags.ts";

/** Minutes since midnight: dark from here... */
export const AUTO_DARK_FROM = 19 * 60;
/** ...until here. */
export const AUTO_DARK_TO = 7 * 60;

/** Whether Auto wants the dark look at `now` (local time). */
export const wantsDark = (now: Date): boolean => inSchedule(now.getHours() * 60 + now.getMinutes(), { from: AUTO_DARK_FROM, to: AUTO_DARK_TO });

export interface AutoAppearanceOptions {
  flags: { set(patch: Partial<Flags>): void };
  /** Whether `appearance.auto` is on. */
  enabled(): boolean;
  now?: () => Date;
  /** How often to look; the answer only changes at 7 and 7. */
  everyMs?: number;
}

export class AutoAppearance {
  /** What Auto last wanted; null while it was off, so turning it on applies at once. */
  private last: boolean | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: AutoAppearanceOptions) {}

  start(): () => void {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.options.everyMs ?? 30_000);
    return () => clearInterval(this.timer);
  }

  /** Look at the clock and the setting. Called on a timer, and when the setting changes. */
  tick(): void {
    if (!this.options.enabled()) {
      this.last = null;
      return;
    }
    const dark = wantsDark((this.options.now ?? (() => new Date()))());
    if (dark === this.last) return;
    this.last = dark;
    this.options.flags.set({ dark });
  }
}
