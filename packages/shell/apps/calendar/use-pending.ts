/**
 * The new event being named in place: where it starts (on the grid, or a
 * chip in the month), saving it with the name typed, and dropping it.
 */

import { useRef, useState } from "react";
import { type Day, dayPart } from "../../src/shared/calendar/dates.ts";
import { type ClockPrefs, usesHour24 } from "../../src/shared/time/clock.ts";
import { pendingAt, pendingInput } from "./grid-edits.ts";
import type { Pending } from "./inline-title.tsx";
import type { CalendarModel } from "./model.ts";
import type { Target } from "./target.ts";

export interface PendingOptions {
  model: CalendarModel;
  today: Day;
  prefs: ClockPrefs;
  /** Where a new event goes (target.ts); null with no calendars. */
  destination: Target | null;
  /** Nothing else is picked or open while an event is named. */
  clearSelection: () => void;
  /** The keyboard goes back to the window. */
  takeKeys: () => void;
}

export interface PendingEvent {
  pending: Pending | null;
  /** Whether an event is being named (read at the time of a press, not of a render). */
  isNaming: () => boolean;
  set: (pending: Pending | ((now: Pending | null) => Pending | null)) => void;
  /** A new event named in place, in the calendar new events go to (shown again first if every one is hidden). */
  start: (day: Day, minutes: number | null) => void;
  save: () => void;
  drop: () => void;
}

export function usePending({ model, today, prefs, destination, clearSelection, takeKeys }: PendingOptions): PendingEvent {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const start = (day: Day, minutes: number | null): void => {
    if (destination === null) return;
    if (destination.reveal && !model.reveal(destination.calendarId)) return;
    model.dismissMessages();
    clearSelection();
    model.select(day);
    setPending(pendingAt(destination.calendarId, day, minutes));
  };

  const save = (): void => {
    const named = pendingRef.current;
    if (!named) return;
    pendingRef.current = null;
    setPending(null);
    const input = pendingInput(named, today, !usesHour24(prefs));
    const made = model.addEvent(named.calendarId, input);
    if (made && dayPart(input.start) !== dayPart(named.start)) model.goTo(dayPart(input.start));
    takeKeys();
  };

  const drop = (): void => {
    pendingRef.current = null;
    setPending(null);
    takeKeys();
  };

  return { pending, isNaming: () => pendingRef.current !== null, set: setPending, start, save, drop };
}
