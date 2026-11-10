/**
 * What Calendar can take back (Edit › Undo, @dashi/ui's stack): a new event,
 * an edit (a "Move Event" when only its time or calendar changed), a deleted
 * event, and one deleted occurrence of a repeat. Each step puts the event
 * back exactly as it was (its uid, alerts, and the properties Calendar does
 * not edit), and Redo puts the later version back.
 */

import type { UndoAction } from "@dashi/ui";
import type { CalendarStore } from "../../src/shared/calendar/store.ts";
import type { CalEvent } from "../../src/shared/calendar/types.ts";

/** Where an event was and is, and how it looked each time; null where it did not exist. */
export interface EventChange {
  before: { calendarId: string; event: CalEvent } | null;
  after: { calendarId: string; event: CalEvent } | null;
}

/** "Move Event" when only the time or the calendar changed, else "Edit Event"; "New Event" and "Delete Event" by what is missing. */
export function changeName({ before, after }: EventChange): string {
  if (!before) return "New Event";
  if (!after) return "Delete Event";
  const same = (key: keyof CalEvent) => JSON.stringify(before.event[key]) === JSON.stringify(after.event[key]);
  const moved = before.calendarId !== after.calendarId || !same("start") || !same("end");
  const kept = (["title", "allDay", "location", "notes", "repeat", "rawRule", "exdates", "overrides", "alert"] as const).every(same);
  return moved && kept ? "Move Event" : "Edit Event";
}

function show(store: CalendarStore, from: EventChange["before"], to: EventChange["before"]): void {
  // The new place first, so a failure never loses the event.
  if (to) store.put(to.calendarId, to.event);
  if (from && (!to || from.calendarId !== to.calendarId)) store.delete(from.calendarId, from.event.uid);
}

/** The step for `change`; `named` overrides the name (one deleted occurrence is a "Delete Event" too). */
export function eventStep(change: EventChange, store: CalendarStore, reload: () => void, named?: string): UndoAction {
  return {
    name: named ?? changeName(change),
    undo: () => {
      show(store, change.after, change.before);
      reload();
    },
    do: () => {
      show(store, change.before, change.after);
      reload();
    },
  };
}
