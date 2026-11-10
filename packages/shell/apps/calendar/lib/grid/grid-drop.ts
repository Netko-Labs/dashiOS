/**
 * What a drag let go does: a drawn span becomes a new event to name in
 * place; a moved or stretched event is changed in the model (a change to one
 * time of a repeat asks first).
 */

import { dayPart, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { CalendarModel } from "../model.ts";
import type { SheetState } from "../sheets/sheets.tsx";
import type { Target } from "../target.ts";
import { isSameTimes } from "./drag.ts";
import type { Drag } from "./gesture.ts";
import { asksScope, dropName, movedInput, refOf } from "./grid-edits.ts";
import type { Pending } from "./inline-title.tsx";

export interface DropContext {
  model: CalendarModel;
  destination: Target | null;
  /** Start naming a new event. */
  name: (pending: Pending) => void;
  pick: (occurrence: Occurrence | null) => void;
  ask: (sheet: SheetState) => void;
}

export function finishDrag(drag: Drag, { model, destination, name, pick, ask }: DropContext): void {
  const preview = drag.preview;
  if (!preview) return;
  if (drag.kind === "create") {
    if (destination === null || (destination.reveal && !model.reveal(destination.calendarId))) return;
    model.select(drag.day);
    name({ calendarId: destination.calendarId, start: preview.start, end: preview.end, allDay: false, title: "" });
    return;
  }
  const occurrence = drag.occurrence;
  if (!occurrence || isSameTimes(occurrence, preview)) return;
  const input = movedInput(occurrence, preview);
  const newName = dropName(occurrence, preview);
  pick(occurrence);
  model.select(dayPart(preview.start));
  if (asksScope(occurrence)) {
    ask({ kind: "scope", action: "change", ref: refOf(occurrence), title: occurrence.event.title, input, name: newName, allowThis: true });
  } else model.changeOccurrence(refOf(occurrence), input, "all", { name: newName });
}
