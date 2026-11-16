/**
 * The keys scroll a detail (an extension's one long page: a pull request's
 * body): ↑ and ↓ by a few lines, Page Up and Page Down by its height less a
 * line, Home and End to its ends. The detail on screen gives its scroll view
 * here (detail-view.tsx); the launcher's keys ask `step` before they move a
 * selection (use-acts.ts). One launcher a shell, so one detail at a time.
 */

import type { ScrollInfo, ViewHandle } from "@mirinjs/metal";
import type { Move } from "./selection.ts";

/** What ↑ or ↓ scrolls by, in px: about three lines of a detail's words. */
const STEP = 48;

export class DetailScroll {
  private view: Pick<ViewHandle, "scrollTo" | "scrollToEnd"> | null = null;
  private y = 0;
  private height = 0;
  private most = Number.POSITIVE_INFINITY;

  /** The detail's scroll view, or null when it goes. */
  readonly attach = (view: Pick<ViewHandle, "scrollTo" | "scrollToEnd"> | null): void => {
    this.view = view;
    this.y = 0;
    this.height = 0;
    this.most = Number.POSITIVE_INFINITY;
  };

  /** Where the view stands now (its `onScroll`): the wheel and the touchpad move it too. */
  readonly scrolled = (info: ScrollInfo): void => {
    this.y = info.contentOffset.y;
    this.height = info.layoutMeasurement.height;
    this.most = Math.max(0, info.contentSize.height - info.layoutMeasurement.height);
  };

  /** Scroll for `how`; whether a detail took the key. */
  step(how: Move): boolean {
    const view = this.view;
    if (!view) return false;
    if (how === "last") {
      view.scrollToEnd();
      this.y = Number.isFinite(this.most) ? this.most : this.y;
      return true;
    }
    const page = Math.max(STEP, this.height - STEP / 2);
    const by = { up: -STEP, down: STEP, "page-up": -page, "page-down": page, first: Number.NEGATIVE_INFINITY }[how];
    this.y = Math.min(this.most, Math.max(0, this.y + by));
    view.scrollTo({ y: this.y });
    return true;
  }
}

export const detailScroll = new DetailScroll();
