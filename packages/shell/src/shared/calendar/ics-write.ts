/**
 * Writes an iCalendar file: the calendar's header, each event with its
 * changed occurrences, the times in the form each event keeps them, and the
 * text folded at 75 octets with CRLF line ends.
 */

import { dayPart, toBasicDay, toBasicLocal } from "./dates.ts";
import { escapeText, fold, formatDuration, paramValue } from "./ics-lines.ts";
import { formatRule } from "./rules.ts";
import type { CalEvent, EventBody, IcsFile, Override } from "./types.ts";
import { UTC } from "./zones.ts";

const MAX_NAME = 100;
const PRODID = "-//Dashi//Calendar//EN";

export function cleanName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

function timeProperty(name: string, local: string, allDay: boolean, zone: string | null): string {
  if (allDay) return `${name};VALUE=DATE:${toBasicDay(dayPart(local))}`;
  if (zone === null) return `${name}:${toBasicLocal(local)}`;
  if (zone === UTC) return `${name}:${toBasicLocal(local)}Z`;
  return `${name};TZID=${paramValue(zone)}:${toBasicLocal(local)}`;
}

/** The lines after DTSTAMP that every VEVENT has: times, words, its other properties, and alarms (with END:VEVENT). */
function bodyLines(body: EventBody, between: readonly string[]): string[] {
  const lines = [
    timeProperty("DTSTART", body.start, body.allDay, body.zone),
    timeProperty("DTEND", body.end, body.allDay, body.zone),
    `SUMMARY:${escapeText(body.title)}`,
  ];
  if (body.location !== "") lines.push(`LOCATION:${escapeText(body.location)}`);
  if (body.notes !== "") lines.push(`DESCRIPTION:${escapeText(body.notes)}`);
  lines.push(...between, ...body.extra);
  if (body.alert !== null)
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(body.title || "Event")}`, `TRIGGER:${formatDuration(-body.alert)}`, "END:VALARM");
  lines.push(...body.rawAlarms, "END:VEVENT");
  return lines;
}

function writeOverride(event: CalEvent, override: Override): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${escapeUid(event.uid)}`,
    `DTSTAMP:${override.stamp}`,
    timeProperty("RECURRENCE-ID", override.recurrenceId, event.allDay, event.zone),
    ...bodyLines(override, []),
  ];
}

function writeEvent(event: CalEvent): string[] {
  const rules: string[] = [];
  if (event.repeat) rules.push(`RRULE:${formatRule(event.repeat, event.allDay, event.zone)}`);
  else if (event.rawRule !== null) rules.push(`RRULE:${event.rawRule}`);
  for (const exdate of event.exdates) rules.push(timeProperty("EXDATE", exdate, event.allDay, event.zone));
  return [
    "BEGIN:VEVENT",
    `UID:${escapeUid(event.uid)}`,
    `DTSTAMP:${event.stamp}`,
    ...bodyLines(event, rules),
    ...event.overrides.flatMap((override) => writeOverride(event, override)),
  ];
}

/** A UID is written as is except for characters that would end the line. */
const escapeUid = (uid: string): string => uid.replace(/[\u0000-\u001f\u007f]/g, "");

/** The file's text: CRLF lines folded at 75 octets. */
export function writeIcs(
  file: Pick<IcsFile, "events" | "headerExtra" | "preserved"> & Partial<Pick<IcsFile, "timezones">> & { name: string; color: string },
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(cleanName(file.name))}`,
    `X-APPLE-CALENDAR-COLOR:${file.color}`,
    ...file.headerExtra,
    ...(file.timezones ?? []),
  ];
  for (const event of file.events) lines.push(...writeEvent(event));
  lines.push(...file.preserved, "END:VCALENDAR");
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}

/** Adds to `into` (the calendar's VTIMEZONE lines) each block of `brought` it has no zone of that name for. */
export function addTimezoneBlocks(into: string[], brought: readonly string[]): void {
  const zones = new Set(into.filter((line) => line.startsWith("TZID")));
  let block: string[] = [];
  for (const line of brought) {
    block.push(line);
    if (line.toUpperCase() !== "END:VTIMEZONE") continue;
    const id = block.find((each) => each.startsWith("TZID"));
    if (id === undefined || !zones.has(id)) into.push(...block);
    if (id !== undefined) zones.add(id);
    block = [];
  }
}
