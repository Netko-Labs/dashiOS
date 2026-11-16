/**
 * edit_event and delete_event (tools/lib/calendar-edit.ts) through the
 * store the Calendar app uses: an event by its uid (list_events gives it),
 * a change to the whole event (a repeating one changes every occurrence).
 * The result carries what the event was, so the change can be put back
 * with edit_event; a deleted event is first put in the Trash as an .ics
 * file, which Calendar imports back (docs/actions.md, "Notes and Calendar").
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  addMinutes,
  type CalEvent,
  type Calendar,
  CalendarError,
  CalendarStore,
  dayPart,
  defaultRoot,
  eventIcs,
  type Local,
} from "../../shared/calendar/index.ts";
import { type Exec, exec, quietContext, trashPaths } from "../../shared/files/index.ts";
import { type RunContext, type ToolResult, text, toolError } from "../context.ts";

export interface EventChange {
  uid: string;
  title: string | null;
  /** A day (all day) or a day and time, as create_event takes them. */
  start: string | null;
  end: string | null;
  location: string | null;
  notes: string | null;
  /** Another calendar, by name or id. */
  calendar: string | null;
}

function attempt(action: (store: CalendarStore) => ToolResult): ToolResult {
  try {
    return action(new CalendarStore(defaultRoot()));
  } catch (error) {
    return toolError(error instanceof CalendarError ? error.message : "The calendars folder could not be read or written.");
  }
}

function locate(calendars: readonly Calendar[], uid: string): { calendar: Calendar; event: CalEvent } | null {
  for (const calendar of calendars) {
    const event = calendar.events.find((each) => each.uid === uid);
    if (event) return { calendar, event };
  }
  return null;
}

/** An event as the result says what it was. */
function was(event: CalEvent, calendar: Calendar) {
  return {
    title: event.title,
    calendar: calendar.name,
    start: event.allDay ? dayPart(event.start) : event.start,
    end: event.allDay ? addDays(dayPart(event.end), -1) : event.end,
    location: event.location,
    notes: event.notes.slice(0, 1000),
    repeats: event.repeat !== null || event.rawRule !== null,
  };
}

/** New start and end: a new start keeps the event's length unless an end is given; a day makes it all day. */
function times(event: CalEvent, change: EventChange): { allDay: boolean; start: Local; end: Local } {
  if (change.start === null && change.end === null) return { allDay: event.allDay, start: event.start, end: event.end };
  const startGiven = change.start ?? (event.allDay ? dayPart(event.start) : event.start);
  const allDay = !startGiven.includes("T");
  const start: Local = allDay ? `${startGiven}T00:00` : startGiven;
  if (allDay) return { allDay, start, end: `${addDays(change.end ?? (change.start === null ? addDays(dayPart(event.end), -1) : startGiven), 1)}T00:00` };
  const length = Math.max(0, (Date.parse(`${event.end}Z`) - Date.parse(`${event.start}Z`)) / 60_000) || 60;
  return { allDay, start, end: change.end ?? addMinutes(start, event.allDay ? 60 : length) };
}

export function editEvent(change: EventChange, ctx: RunContext): ToolResult {
  ctx.status("Changing an event");
  return attempt((store) => {
    const { calendars } = store.scan();
    const found = locate(calendars, change.uid);
    if (!found) return toolError("There is no event with that uid: list_events gives them.");
    const target =
      change.calendar === null
        ? null
        : (calendars.find((each) => each.id === change.calendar || each.name.toLowerCase() === change.calendar?.toLowerCase()) ?? null);
    if (change.calendar !== null && !target) return toolError(`There is no calendar called “${change.calendar}”; list_calendars names them.`);
    const { event, calendar } = found;
    const when = times(event, change);
    const updated = store.update(
      calendar.id,
      event.uid,
      {
        title: change.title ?? event.title,
        ...when,
        location: change.location ?? event.location,
        notes: change.notes ?? event.notes,
      },
      target?.id,
    );
    return text(`Changed “${updated.title}”${event.repeat ? " (every occurrence)" : ""}. It was: ${JSON.stringify(was(event, calendar))}.`, {
      uid: updated.uid,
      was: was(event, calendar),
    });
  });
}

/** The event as an .ics file in the Trash: opening it in Calendar brings it back (its uid is free again). */
async function keepInTrash(calendar: Calendar, event: CalEvent, run: Exec): Promise<boolean> {
  // On the home folder's disk: `gio trash` can't move a file from /run (tmpfs) into the home Trash.
  const dir = join(process.env.XDG_CACHE_HOME || join(process.env.HOME || homedir(), ".cache"), "dashi", "deleted-events");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${(event.title || "Event").replace(/[/\0]/g, "-").slice(0, 80)}.ics`;
  const path = join(dir, name);
  writeFileSync(path, eventIcs(calendar, event), { mode: 0o600 });
  const result = await trashPaths([path], quietContext(), run);
  if (result.failed.length > 0) rmSync(path, { force: true });
  return result.failed.length === 0;
}

export async function deleteEvent(uid: string, ctx: RunContext, run: Exec = exec): Promise<ToolResult> {
  ctx.status("Deleting an event");
  let store: CalendarStore;
  let found: ReturnType<typeof locate>;
  try {
    store = new CalendarStore(defaultRoot());
    found = locate(store.scan().calendars, uid);
  } catch (error) {
    return toolError(error instanceof CalendarError ? error.message : "The calendars folder could not be read.");
  }
  if (!found) return toolError("There is no event with that uid: list_events gives them.");
  // Kept first: an event that can't be kept is not deleted.
  if (!(await keepInTrash(found.calendar, found.event, run).catch(() => false)))
    return toolError("A copy of the event couldn't be put in the Trash, so it was not deleted.");
  const { calendar } = found;
  return attempt(() => {
    store.delete(calendar.id, uid);
    const before = was(found.event, calendar);
    return text(
      `Deleted “${before.title}”${before.repeats ? " and all its occurrences" : ""}. A copy is in the Trash as “${before.title || "Event"}.ics”: opening it in Calendar puts it back.`,
      { deleted: uid, was: before },
    );
  });
}
