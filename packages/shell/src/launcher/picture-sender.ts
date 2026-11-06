/**
 * When the window pictures' places go to the compositor (pictures.ts): only
 * once the frames have held still, so a picture never shows where a frame
 * was a moment ago. The frames are laid out in passes as they appear (the
 * strip, then the rows giving way under it), and each pass reports new
 * bounds: the places are sent once no pass has moved them for
 * `PICTURES_SETTLE_MS`. Pictures already showing are hidden the moment
 * their frames move or change, and shown again once the new places hold.
 */

import { realTimers, type Timers } from "./budget.ts";
import { type PictureRect, sameRects } from "./pictures.ts";

/** How long the frames must hold still before their pictures are shown: a few frames at 60 Hz. */
export const PICTURES_SETTLE_MS = 50;

export class PictureSender {
  /** What the compositor shows now; null before anything was sent. */
  private shown: PictureRect[] | null = null;
  private timer: unknown = null;

  constructor(
    private readonly tell: (rects: PictureRect[]) => void,
    private readonly timers: Timers = realTimers,
  ) {}

  /** The frames' places now: `null` while a frame is still to be laid out, `[]` for no pictures. */
  update(rects: PictureRect[] | null): void {
    if (rects !== null && sameRects(this.shown, rects)) {
      this.cancel();
      return;
    }
    // What shows is no longer where the frames are: hidden until the new places hold still.
    this.hide();
    this.cancel();
    if (rects === null || rects.length === 0) return;
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.shown = rects;
      this.tell(rects);
    }, PICTURES_SETTLE_MS);
  }

  /** The launcher goes: nothing is shown, nothing is still to come. */
  stop(): void {
    this.cancel();
    this.hide();
    this.shown = null;
  }

  private hide(): void {
    if (this.shown && this.shown.length > 0) this.tell([]);
    if (this.shown !== null) this.shown = [];
  }

  private cancel(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
  }
}
