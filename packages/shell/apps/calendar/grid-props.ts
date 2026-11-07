/** What the day, week, and month views are told by the window, and tell it back: the drag, the event being named, what is picked. */

import type { Bounds, PointerInfo } from "@mirinjs/metal";
import type { Day } from "./dates.ts";
import type { DragStart, Geometry } from "./drag.ts";
import type { Drag } from "./gesture.ts";
import type { Pending } from "./inline-title.tsx";
import type { Occurrence } from "./types.ts";

export interface GridState {
  /** The drag under way (once it moved). */
  drag: Drag | null;
  /** A new event being named in place. */
  pending: Pending | null;
  /** The day picked. */
  selected: Day;
  /** The half hour picked on the grid (minutes after midnight), or null. */
  selectedSlot: number | null;
  /** The event picked (`occurrenceKey`), or null. */
  selectedEvent: string | null;
  /**
   * The time a new event from the + button (or ❖N, Return) starts at, for the
   * hours to scroll to it; `count` tells one ask from the next.
   */
  reveal: { minutes: number; count: number } | null;
}

export interface GridHandlers {
  /** A press on the grid: the start of a drag or a click (gesture.ts). */
  begin(start: DragStart, geometry: Geometry): void;
  /** Every later phase of that press. */
  track(info: PointerInfo): void;
  /** A click on an empty day or on the all-day strip (`minutes` null). */
  clickDay(day: Day, minutes: number | null): void;
  /** A press on an event: its popover. */
  open(occurrence: Occurrence, bounds: Bounds | undefined): void;
  /** A day's name, or its "N more": that day on its own. */
  showDay(day: Day): void;
  pendingTitle(title: string): void;
  savePending(): void;
  dropPending(): void;
}
