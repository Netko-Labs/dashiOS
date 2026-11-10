/**
 * A touchpad swipe the shell claimed, read as the Mac reads it: once it has
 * gone far enough to have a direction, sideways moves between Spaces with
 * the windows following the fingers, and up or down opens or closes Mission
 * Control when it ends. Pure: it says what to do, gestures.ts does it.
 */

// biome-ignore lint/nursery/noImportCycles: H5 offender (scripts/lists/import-cycles.txt)
import { swipeDirection } from "../gestures.ts";
import type { SpacesState } from "./model.ts";

/** How far (logical pixels, summed) a swipe goes before its direction is decided. */
export const AXIS_LOCK = 12;
/** How far sideways the fingers go for a whole Space. */
export const SPACE_SWIPE = 360;
/** Let go past this much of the way, the switch completes; short of it, it goes back. */
export const COMMIT_AT = 0.3;

export type SwipeStep =
  | { kind: "none" }
  /** Mission Control opens (up) or closes (down). */
  | { kind: "overview"; open: boolean }
  /** Hold the switch to `target` this far along. */
  | { kind: "space-hold"; target: number; progress: number }
  /** Let the switch to `target` finish. */
  | { kind: "space-finish"; target: number }
  /** Go back to `origin` from wherever the switch got to. */
  | { kind: "space-back"; origin: number };

const NONE: SwipeStep = { kind: "none" };

export class SwipeTracker {
  private dx = 0;
  private dy = 0;
  private axis: "x" | "y" | null = null;
  private origin = 0;
  private count = 1;
  private target: number | null = null;
  private progress = 0;
  private held = false;
  private active = false;

  /** A swipe began, with the Spaces as they are. */
  begin(spaces: SpacesState): void {
    this.dx = 0;
    this.dy = 0;
    this.axis = null;
    this.origin = spaces.current;
    this.target = null;
    this.progress = 0;
    this.held = false;
    this.active = true;
    this.count = spaces.count;
  }

  update(dx: number, dy: number): SwipeStep {
    if (!this.active) return NONE;
    this.dx += dx;
    this.dy += dy;
    if (this.axis === null) {
      if (Math.max(Math.abs(this.dx), Math.abs(this.dy)) < AXIS_LOCK) return NONE;
      this.axis = Math.abs(this.dx) > Math.abs(this.dy) ? "x" : "y";
      if (this.axis === "x") {
        // Fingers to the left bring the Space on the right.
        const target = this.origin + (this.dx < 0 ? 1 : -1);
        this.target = target >= 0 && target < this.count ? target : null;
      }
    }
    if (this.axis !== "x" || this.target === null) return NONE;
    const toward = this.target > this.origin ? -this.dx : this.dx;
    this.progress = Math.min(1, Math.max(0, toward / SPACE_SWIPE));
    this.held = true;
    return { kind: "space-hold", target: this.target, progress: this.progress };
  }

  end(cancelled: boolean): SwipeStep {
    if (!this.active) return NONE;
    this.active = false;
    if (this.axis === "x") {
      if (this.target === null || !this.held) return NONE;
      return !cancelled && this.progress >= COMMIT_AT ? { kind: "space-finish", target: this.target } : { kind: "space-back", origin: this.origin };
    }
    const direction = cancelled ? null : swipeDirection(this.dx, this.dy);
    if (direction === "up") return { kind: "overview", open: true };
    if (direction === "down") return { kind: "overview", open: false };
    return NONE;
  }
}
