/**
 * The frames the shell asked for, until the apps catch up. dashi-comp moves
 * a window at once when asked (`frame`), but its size changes only when the
 * app draws at the new size, which a busy app takes a while to do; until
 * then the compositor still reports the old size. So the size the shell
 * last asked for is the window's size, until the app reports exactly that
 * (it caught up) and from then on what it reports again (an app that sizes
 * itself), or the person resizes it by hand (`forget`). Where the window is
 * comes from the compositor: it is current, and the person may have moved it.
 */

import type { Rect } from "./layout.ts";

export class PendingFrames {
  private readonly sizes = new Map<number, { width: number; height: number }>();

  /** The shell asked for `frame`. */
  asked(window: number, frame: Rect): void {
    this.sizes.set(window, { width: frame.width, height: frame.height });
  }

  /** The person resized it, or it closed: what the compositor reports is right again. */
  forget(window: number): void {
    this.sizes.delete(window);
  }

  /** The window's frame as it is about to be: where the compositor has it, at the size last asked for while the app has not drawn it yet. */
  frameOf(window: number, reported: Rect): Rect {
    const size = this.sizes.get(window);
    if (!size) return reported;
    if (size.width === reported.width && size.height === reported.height) {
      // Caught up: from now on, what it reports.
      this.sizes.delete(window);
      return reported;
    }
    return { x: reported.x, y: reported.y, ...size };
  }
}
