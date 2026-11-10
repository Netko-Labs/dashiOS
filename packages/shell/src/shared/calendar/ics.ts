/**
 * iCalendar (RFC 5545), the subset Calendar writes and reads strictly.
 *
 * Written: VCALENDAR with X-WR-CALNAME and X-APPLE-CALENDAR-COLOR, the
 * VTIMEZONEs it was read with; VEVENT with UID, DTSTAMP, DTSTART and DTEND (a
 * date for an all-day event; else a time with its TZID, a UTC time, or a
 * floating one, as the event keeps it), SUMMARY, LOCATION, DESCRIPTION, RRULE
 * (rules.ts), EXDATE; one display VALARM with a relative TRIGGER; and after
 * a repeat, its changed occurrences as VEVENTs with its UID and a
 * RECURRENCE-ID. Lines are folded at 75 octets and end in CRLF.
 *
 * Time zones (zones.ts): a time keeps its zone. A TZID or a UTC ("Z") time
 * is read as a wall clock in that zone and written back the same way, so the
 * event stays at its instant when this computer's zone changes; VTIMEZONE
 * components are kept as written. A zone this computer does not know is kept
 * and shown as floating time.
 *
 * Read strictly: an event without a UID or a readable DTSTART, or with a
 * repeated single-valued property, is not shown, nor is a changed occurrence
 * whose repeat is not in the file. Nothing that is not understood is lost,
 * though: such events, other components (to-dos), unknown properties, and
 * alarms Calendar does not edit are kept as written and written back.
 */

import { type Component, parseComponents } from "./ics-components.ts";
import { unescapeText, unfold } from "./ics-lines.ts";
import { eventOf, type ReadEvent, readEvent } from "./ics-read.ts";
import { inEventZone } from "./ics-time.ts";
import { cleanName } from "./ics-write.ts";
import { type CalEvent, CalendarError, type IcsFile } from "./types.ts";

export { type ContentLine, escapeText, fold, formatDuration, parseDuration, parseLine, unescapeText, unfold } from "./ics-lines.ts";
export { isCancelled } from "./ics-read.ts";
export { type ParsedTime, parseTime, stampNow } from "./ics-time.ts";
export { cleanName, writeIcs } from "./ics-write.ts";

export const MAX_ICS_BYTES = 4 * 1024 * 1024;
export const MAX_EVENTS = 20_000;

export const isColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

function titleOfRaw(child: Component): string {
  const title = child.lines.find((line) => line.name === "SUMMARY")?.value ?? "";
  return title ? ` (“${unescapeText(title).slice(0, 40)}”)` : "";
}

/** An .ics file's text as what Calendar understands of it; throws a CalendarError when it is not an iCalendar file at all. */
export function parseIcs(text: string): IcsFile {
  if (text.length > MAX_ICS_BYTES * 2) throw new CalendarError("That file is too large to be a calendar.");
  const root = parseComponents(unfold(text.replace(/^﻿/, "")));
  const calendars = root.children;
  if (calendars.length !== 1 || calendars[0]?.name !== "VCALENDAR") throw new CalendarError("Not an iCalendar file: it has no single VCALENDAR.");
  const calendar = calendars[0];
  const file: IcsFile = { name: null, color: null, events: [], headerExtra: [], timezones: [], preserved: [], problems: [] };
  for (const line of calendar.lines) {
    if (line.name === "X-WR-CALNAME" || (line.name === "NAME" && file.name === null)) file.name = cleanName(unescapeText(line.value)) || null;
    else if (line.name === "X-APPLE-CALENDAR-COLOR" || (line.name === "COLOR" && file.color === null)) {
      const color = line.value.trim();
      if (isColor(color) || /^#[0-9a-fA-F]{8}$/.test(color)) file.color = color.slice(0, 7).toLowerCase();
      else if (line.name === "X-APPLE-CALENDAR-COLOR") file.headerExtra.push(line.raw);
    } else if (line.name === "VERSION" || line.name === "PRODID" || line.name === "CALSCALE") continue;
    else file.headerExtra.push(line.raw);
  }
  const masters = new Map<string, CalEvent>();
  const changed: Array<{ read: ReadEvent; child: Component }> = [];
  for (const child of calendar.children) {
    if (child.name === "VTIMEZONE") {
      file.timezones.push(...child.raw);
      continue;
    }
    if (child.name !== "VEVENT") {
      file.preserved.push(...child.raw);
      continue;
    }
    const read = readEvent(child);
    if (typeof read === "string") {
      file.problems.push(`An event${titleOfRaw(child)} is kept but not shown: ${read}.`);
      file.preserved.push(...child.raw);
    } else if (read.recurrenceId) {
      changed.push({ read, child });
    } else if (masters.has(read.uid)) {
      file.problems.push(`An event (“${read.body.title.slice(0, 40)}”) is kept but not shown: its UID is used twice.`);
      file.preserved.push(...child.raw);
    } else {
      const event = eventOf(read);
      masters.set(read.uid, event);
      file.events.push(event);
      if (file.events.length > MAX_EVENTS) throw new CalendarError("That calendar has too many events.");
    }
  }
  // Changed occurrences join their repeat, wherever they were in the file.
  for (const { read, child } of changed) {
    const master = masters.get(read.uid);
    const recurrenceId = master && read.recurrenceId ? inEventZone(read.recurrenceId, master) : null;
    if (!master || recurrenceId === null || (!master.repeat && master.rawRule === null)) {
      file.problems.push(`An event${titleOfRaw(child)} is kept but not shown: it changes one occurrence of a repeat that is not in this calendar.`);
      file.preserved.push(...child.raw);
    } else if (master.overrides.some((each) => each.recurrenceId === recurrenceId)) {
      file.problems.push(`An event${titleOfRaw(child)} is kept but not shown: it changes an occurrence that is already changed.`);
      file.preserved.push(...child.raw);
    } else {
      master.overrides.push({ ...read.body, recurrenceId });
      master.overrides.sort((a, b) => (a.recurrenceId < b.recurrenceId ? -1 : 1));
    }
  }
  return file;
}

/** A new UID for an event made here. */
export const newUid = (): string => `${crypto.randomUUID()}@dashi.calendar`;
