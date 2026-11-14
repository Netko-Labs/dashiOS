/**
 * What a press of one of the two keys turned out to be
 * (shared/pill/keys.ts): the compositor says the key went down and came up
 * (`held-key`), and this says `down`, then `hold` and `up`, or `tap`, or
 * `double-tap`, or `chord`.
 */

import { DOUBLE_MS, HOLD_MS, type KeyGesture, type KeyGestureKind, type PillKey } from "../../shared/pill/index.ts";
import type { Timers } from "../../shared/time/index.ts";

export interface GestureDeps {
  timers: Timers;
  now(): number;
  tell(gesture: KeyGesture): void;
  /** A second press soon after a tap is a `double-tap` (the dictation key). */
  doubles?: boolean;
}

export class KeyGestures {
  private press: { held: boolean; timer: unknown; second: boolean } | null = null;
  private tappedAt: number | null = null;

  constructor(
    private readonly key: PillKey,
    private readonly deps: GestureDeps,
  ) {}

  private tell(gesture: KeyGestureKind): void {
    this.deps.tell({ key: this.key, gesture, at: this.deps.now() });
  }

  /** The key is down and has become a hold. */
  get held(): boolean {
    return this.press?.held === true;
  }

  down(): void {
    if (this.press) return;
    const now = this.deps.now();
    if (this.deps.doubles && this.tappedAt !== null && now - this.tappedAt <= DOUBLE_MS) {
      this.tappedAt = null;
      this.press = { held: false, timer: null, second: true };
      return this.tell("double-tap");
    }
    this.tappedAt = null;
    const press = {
      held: false,
      second: false,
      timer: this.deps.timers.set(() => {
        if (this.press !== press) return;
        press.held = true;
        this.tell("hold");
      }, HOLD_MS),
    };
    this.press = press;
    this.tell("down");
  }

  /** The key came up, or another key went down under it (`chord`). */
  up(chord = false): void {
    const press = this.press;
    if (!press) return;
    this.press = null;
    this.deps.timers.clear(press.timer);
    // The second press of a double tap said all it had to as it went down.
    if (press.second) return;
    if (chord) return this.tell("chord");
    if (press.held) return this.tell("up");
    this.tappedAt = this.deps.now();
    this.tell("tap");
  }
}
