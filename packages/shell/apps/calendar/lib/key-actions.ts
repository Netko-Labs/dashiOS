/**
 * What a key the window got does on the grid (window-keys.ts says which key
 * means what): cancel, move the selection, open or make an event, delete,
 * go to today, change the view, step.
 */

import type { WindowKeyInfo } from "@mirinjs/metal";
import type { Occurrence } from "../../../src/shared/calendar/types.ts";
import type { View } from "./layout.ts";
import type { CalendarModel } from "./model.ts";
import { keyAction } from "./window-keys.ts";

export interface KeyContext {
  model: CalendarModel;
  view: View;
  firstDay: number;
  picked: Occurrence | null;
  pick: (occurrence: Occurrence | null) => void;
  /** Forget the picked half hour. */
  clearSlot: () => void;
  /** Cancels a drag under way; false when there was none. */
  cancelDrag: () => boolean;
  openSheet: (occurrence: Occurrence) => void;
  newEvent: () => void;
  deleteOccurrence: (occurrence: Occurrence) => void;
}

export function runKey(key: WindowKeyInfo, context: KeyContext): void {
  const { model, picked } = context;
  const action = keyAction(key, context.view);
  if (!action) return;
  switch (action.kind) {
    case "escape":
      if (context.cancelDrag()) return;
      if (picked) return context.pick(null);
      return context.clearSlot();
    case "move":
      context.pick(null);
      return model.moveSelection(action.days, context.firstDay);
    case "enter":
      return picked ? context.openSheet(picked) : context.newEvent();
    case "delete":
      return picked ? context.deleteOccurrence(picked) : undefined;
    case "new":
      return context.newEvent();
    case "today":
      return model.goToday();
    case "view":
      return model.setView(action.view);
    case "step":
      return model.step(action.direction);
  }
}
