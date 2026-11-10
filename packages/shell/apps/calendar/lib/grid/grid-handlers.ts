/**
 * What the views call when the pointer does something on the grid: a press
 * begins a gesture (and saves the event being named), a click on an event
 * opens its popover, the rest forwards. The decisions are use-grid.ts's.
 */

import type { Bounds } from "@mirinjs/metal";
import { type Day, dayPart, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { PendingEvent } from "../hooks/use-pending.ts";
import type { CalendarModel } from "../model.ts";
import type { useGesture } from "./gesture.ts";
import type { GridHandlers } from "./grid-props.ts";

export interface HandlerContext {
  model: CalendarModel;
  gesture: ReturnType<typeof useGesture>;
  named: PendingEvent;
  clickDay: (day: Day, minutes: number | null) => void;
  pick: (occurrence: Occurrence | null) => void;
  setPopover: (popover: { occurrence: Occurrence; bounds: Bounds | undefined } | null) => void;
}

export function gridHandlers({ model, gesture, named, clickDay, pick, setPopover }: HandlerContext): GridHandlers {
  return {
    begin(start, geometry) {
      // A press elsewhere on the grid saves the event being named, as it is.
      if (named.isNaming()) named.save();
      setPopover(null);
      gesture.begin(start, geometry);
    },
    track: (info) => gesture.track(info),
    clickDay,
    open(occurrence, bounds) {
      if (gesture.justDragged()) return;
      if (named.isNaming()) named.save();
      model.dismissMessages();
      pick(occurrence);
      model.select(dayPart(occurrence.start));
      setPopover({ occurrence, bounds });
    },
    showDay: (day) => model.goTo(day, "day"),
    pendingTitle: (title) => named.set((now) => (now ? { ...now, title } : now)),
    savePending: named.save,
    dropPending: named.drop,
  };
}
