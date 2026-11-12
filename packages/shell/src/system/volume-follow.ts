/**
 * A volume that follows PipeWire's word (the session's `pw-dump --monitor`,
 * sound/apps/watch.ts), except just after a slider set it: PipeWire reports
 * each of a drag's writes in turn, a moment late, so for a short while only
 * a word that agrees with what was set is shown. When the moment is over,
 * the newest word heard since the set is shown (none heard: what was set
 * stays, as on a development run, where nothing is written).
 */

import type { Volume } from "./volume.ts";

/** How long what a slider set is shown over an older word from PipeWire. */
export const VOLUME_HOLD_MS = 1000;

/** The same volume, as the sliders read it (a level a hair off is a rounding). */
export const sameVolume = (a: Volume | null, b: Volume | null): boolean =>
  a === null || b === null ? a === b : a.muted === b.muted && Math.abs(a.level - b.level) < 0.006;

export class VolumeFollow {
  private target: Volume | null = null;
  private until = 0;
  /** The newest word since the last set; undefined when none came. */
  private latest: { volume: Volume | null } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly apply: (volume: Volume | null) => void,
    private readonly holdMs: number = VOLUME_HOLD_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** A slider (or a key) set this: PipeWire's word waits a moment unless it agrees. */
  set(shown: Volume): void {
    this.target = shown;
    this.until = this.now() + this.holdMs;
    this.latest = undefined;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.expire(), this.holdMs);
  }

  /** PipeWire's word. */
  heard(volume: Volume | null): void {
    if (this.target !== null && this.now() < this.until) {
      this.latest = { volume };
      if (sameVolume(volume, this.target)) this.apply(volume);
      return;
    }
    // The moment is over: this word is the newest, and nothing heard during the hold may come after it.
    this.target = null;
    this.latest = undefined;
    clearTimeout(this.timer);
    this.apply(volume);
  }

  stop(): void {
    clearTimeout(this.timer);
  }

  private expire(): void {
    this.target = null;
    const latest = this.latest;
    this.latest = undefined;
    if (latest) this.apply(latest.volume);
  }
}
