/**
 * A real double-click for the chooser's rows. Pure. A second press counts
 * only when it lands on the same row, soon enough, and near enough to the
 * first; anything else is a new first click, which only selects. A third
 * press right after a double-click starts over, so it doesn't open twice.
 */

/** The longest wait between the two presses, in ms (GTK's and GNOME's default). */
export const DOUBLE_CLICK_MS = 400;
/** How far apart the two presses may be, in window pixels, on either axis. */
export const DOUBLE_CLICK_DISTANCE = 4;

export interface Press {
  /** What was pressed: the row's path. */
  target: string;
  x: number;
  y: number;
  /** When, in ms. */
  time: number;
}

export interface ClickLimits {
  intervalMs: number;
  distance: number;
}

const LIMITS: ClickLimits = { intervalMs: DOUBLE_CLICK_MS, distance: DOUBLE_CLICK_DISTANCE };

/** Whether `next` makes a double-click with `previous`. */
export function isDoubleClick(previous: Press | null, next: Press, limits: ClickLimits = LIMITS): boolean {
  if (!previous || previous.target !== next.target) return false;
  const wait = next.time - previous.time;
  if (wait < 0 || wait > limits.intervalMs) return false;
  return Math.abs(next.x - previous.x) <= limits.distance && Math.abs(next.y - previous.y) <= limits.distance;
}

/** Remembers the last press; `press` says whether this one completes a double-click. */
export class ClickCounter {
  private last: Press | null = null;

  constructor(private readonly limits: ClickLimits = LIMITS) {}

  press(next: Press): boolean {
    const double = isDoubleClick(this.last, next, this.limits);
    // After a double-click the next press is a first click again.
    this.last = double ? null : next;
    return double;
  }

  /** Forgets the last press (the rows changed: a new folder, a search). */
  reset(): void {
    this.last = null;
  }
}
