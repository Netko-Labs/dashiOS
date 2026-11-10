/**
 * The times in an .ics file: a DTSTART, DTEND, EXDATE or RECURRENCE-ID value
 * read as a wall clock and its zone, the same time seen in an event's zone,
 * and DTSTAMP's "now". Writing a time back is in ics-write.ts.
 */

import { dayPart, fromBasicDay, fromBasicLocal, type Local, toBasicDay } from "./dates.ts";
import type { ContentLine } from "./ics-lines.ts";
import type { EventBody } from "./types.ts";
import { convertWall, hereZone, UTC } from "./zones.ts";

export interface ParsedTime {
  /** The wall clock in `zone`. */
  local: Local;
  allDay: boolean;
  /** "UTC" for a time with a Z, the TZID as written, or null (floating, or a date). */
  zone: string | null;
}

/** A DTSTART, DTEND, EXDATE, or RECURRENCE-ID value; null when it is not one Calendar can read. */
export function parseTime(line: Pick<ContentLine, "params" | "value">, value = line.value): ParsedTime | null {
  const text = value.trim();
  if (line.params.get("VALUE")?.toUpperCase() === "DATE" || /^\d{8}$/.test(text)) {
    const day = fromBasicDay(text);
    return day === null ? null : { local: `${day}T00:00`, allDay: true, zone: null };
  }
  const utc = /^(\d{8}T\d{6})Z$/.exec(text);
  if (utc) {
    const local = fromBasicLocal(utc[1] ?? "");
    return local === null ? null : { local, allDay: false, zone: UTC };
  }
  const local = fromBasicLocal(text);
  if (local === null) return null;
  const zone = line.params.get("TZID")?.trim();
  return { local, allDay: false, zone: zone ? zone.slice(0, 100) : null };
}

/**
 * A time as a wall clock in the zone of the event it belongs to (an EXDATE or
 * a RECURRENCE-ID given in another zone, or as a date for a timed event).
 */
export function inEventZone(time: ParsedTime, event: Pick<EventBody, "allDay" | "start" | "zone">): Local {
  if (event.allDay) return `${dayPart(time.local)}T00:00`;
  if (time.allDay) return `${dayPart(time.local)}${event.start.slice(10)}`;
  if (time.zone === null || time.zone === event.zone) return time.local;
  return convertWall(time.local, time.zone, event.zone ?? hereZone());
}

export function stampNow(now: Date = new Date()): string {
  return `${toBasicDay(now.toISOString().slice(0, 10))}T${now.toISOString().slice(11, 19).replaceAll(":", "")}Z`;
}
