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

import { addMinutes, dayPart, fromBasicDay, fromBasicLocal, type Local, toBasicDay, toBasicLocal } from "./dates.ts";
import { type ContentLine, escapeText, fold, formatDuration, paramValue, parseDuration, parseLine, unescapeText, unfold } from "./ics-lines.ts";
import { formatRule, parseRule } from "./rules.ts";
import { type CalEvent, CalendarError, type EventBody, type IcsFile, type Override } from "./types.ts";
import { convertWall, hereZone, UTC } from "./zones.ts";

export { type ContentLine, escapeText, fold, formatDuration, parseDuration, parseLine, unescapeText, unfold } from "./ics-lines.ts";

export const MAX_ICS_BYTES = 4 * 1024 * 1024;
export const MAX_EVENTS = 20_000;
const MAX_NAME = 100;
const PRODID = "-//Dashi//Calendar//EN";

// ---- Times -----------------------------------------------------------------

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
function inEventZone(time: ParsedTime, event: Pick<EventBody, "allDay" | "start" | "zone">): Local {
  if (event.allDay) return `${dayPart(time.local)}T00:00`;
  if (time.allDay) return `${dayPart(time.local)}${event.start.slice(10)}`;
  if (time.zone === null || time.zone === event.zone) return time.local;
  return convertWall(time.local, time.zone, event.zone ?? hereZone());
}

// ---- Reading ----------------------------------------------------------------

interface Component {
  name: string;
  lines: ContentLine[];
  children: Component[];
  /** Every line from BEGIN to END, as written. */
  raw: string[];
}

function parseComponents(lines: readonly string[]): Component {
  const root: Component = { name: "", lines: [], children: [], raw: [] };
  const stack: Component[] = [root];
  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) throw new CalendarError(`Not an iCalendar file: “${raw.slice(0, 40)}” is not a content line.`);
    const top = stack[stack.length - 1] as Component;
    if (line.name === "BEGIN") {
      const component: Component = { name: line.value.trim().toUpperCase(), lines: [], children: [], raw: [raw] };
      top.children.push(component);
      stack.push(component);
      if (stack.length > 6) throw new CalendarError("Not an iCalendar file: components are nested too deeply.");
    } else if (line.name === "END") {
      if (stack.length < 2 || top.name !== line.value.trim().toUpperCase()) throw new CalendarError("Not an iCalendar file: BEGIN and END do not match.");
      top.raw.push(raw);
      stack.pop();
      if (stack.length > 1) (stack[stack.length - 1] as Component).raw.push(...top.raw);
    } else {
      if (stack.length < 2) throw new CalendarError("Not an iCalendar file: a property is outside any component.");
      top.lines.push(line);
      top.raw.push(raw);
    }
  }
  if (stack.length !== 1) throw new CalendarError("Not an iCalendar file: it ends inside a component.");
  return root;
}

function alarmOf(children: readonly Component[]): { alert: number | null; rawAlarms: string[] } {
  let alert: number | null = null;
  const rawAlarms: string[] = [];
  for (const alarm of children.filter((child) => child.name === "VALARM")) {
    const trigger = alarm.lines.filter((line) => line.name === "TRIGGER");
    const action = alarm.lines
      .find((line) => line.name === "ACTION")
      ?.value.trim()
      .toUpperCase();
    const minutes =
      trigger.length === 1 && trigger[0] && !trigger[0].params.has("VALUE") && (trigger[0].params.get("RELATED") ?? "START").toUpperCase() === "START"
        ? parseDuration(trigger[0].value)
        : null;
    const editable =
      alert === null && minutes !== null && action === "DISPLAY" && !alarm.lines.some((line) => line.name === "REPEAT" || line.name === "DURATION");
    if (editable) alert = 0 - (minutes as number);
    else rawAlarms.push(...alarm.raw);
  }
  return { alert, rawAlarms };
}

/** One VEVENT as Calendar reads it, before a repeat and its changed occurrences are put together. */
interface ReadEvent {
  uid: string;
  body: EventBody;
  rule: string | null;
  exdates: ParsedTime[];
  /** Set on a changed occurrence of a repeat. */
  recurrenceId: ParsedTime | null;
}

/** One VEVENT, or the reason it cannot be shown. */
function readEvent(component: Component): ReadEvent | string {
  const single = new Map<string, ContentLine>();
  const exdateLines: ContentLine[] = [];
  const extra: string[] = [];
  const modeled = new Set(["UID", "DTSTART", "DTEND", "DURATION", "SUMMARY", "LOCATION", "DESCRIPTION", "RRULE", "DTSTAMP", "RECURRENCE-ID"]);
  for (const line of component.lines) {
    if (line.name === "EXDATE") exdateLines.push(line);
    else if (modeled.has(line.name)) {
      if (single.has(line.name)) return `it has more than one ${line.name}`;
      single.set(line.name, line);
    } else extra.push(line.raw);
  }
  const uid = single.get("UID")?.value.trim();
  if (!uid) return "it has no UID";
  if (uid.length > 255) return "its UID is too long";
  const startLine = single.get("DTSTART");
  const start = startLine ? parseTime(startLine) : null;
  if (!startLine || !start) return "its start time is missing or not one Calendar reads";
  let end: string;
  const endLine = single.get("DTEND");
  const durationLine = single.get("DURATION");
  if (endLine && durationLine) return "it has both DTEND and DURATION";
  if (endLine) {
    const parsed = parseTime(endLine);
    if (!parsed || parsed.allDay !== start.allDay) return "its end time is not one Calendar reads";
    end = inEventZone(parsed, { allDay: start.allDay, start: start.local, zone: start.zone });
  } else if (durationLine) {
    const minutes = parseDuration(durationLine.value);
    if (minutes === null || minutes < 0) return "its duration is not one Calendar reads";
    end = addMinutes(start.local, minutes);
  } else {
    end = start.allDay ? addMinutes(start.local, 1440) : start.local;
  }
  if (end < start.local) return "it ends before it starts";
  if (start.allDay && end === start.local) end = addMinutes(start.local, 1440);
  const exdates: ParsedTime[] = [];
  for (const line of exdateLines) {
    for (const part of line.value.split(",")) {
      const parsed = parseTime(line, part);
      if (!parsed) return "an EXDATE is not one Calendar reads";
      exdates.push(parsed);
    }
  }
  const idLine = single.get("RECURRENCE-ID");
  const recurrenceId = idLine ? parseTime(idLine) : null;
  if (idLine && (!recurrenceId || idLine.params.has("RANGE"))) return "it changes occurrences of a repeat in a way Calendar does not read";
  if (idLine && (single.has("RRULE") || exdates.length > 0)) return "it changes one occurrence of a repeat and repeats itself";
  const alarm = alarmOf(component.children);
  const stamp = single.get("DTSTAMP")?.value.trim() ?? "";
  return {
    uid,
    rule: single.get("RRULE")?.value ?? null,
    exdates,
    recurrenceId,
    body: {
      title: unescapeText(single.get("SUMMARY")?.value ?? ""),
      allDay: start.allDay,
      start: start.local,
      end,
      zone: start.zone,
      location: unescapeText(single.get("LOCATION")?.value ?? ""),
      notes: unescapeText(single.get("DESCRIPTION")?.value ?? ""),
      alert: alarm.alert,
      stamp: /^\d{8}T\d{6}Z$/.test(stamp) ? stamp : stampNow(),
      extra,
      rawAlarms: alarm.rawAlarms,
    },
  };
}

/** A repeat (or a single event) from what its VEVENT says. */
function eventOf(read: ReadEvent): CalEvent {
  const { body } = read;
  const repeat = read.rule ? parseRule(read.rule, body.allDay ? null : body.zone) : null;
  return {
    ...body,
    uid: read.uid,
    repeat,
    rawRule: read.rule && !repeat ? read.rule : null,
    exdates: [...new Set(read.exdates.map((time) => inEventZone(time, body)))].sort(),
    overrides: [],
  };
}

/** A changed occurrence ("cancelled" when its STATUS says so). */
export const isCancelled = (body: Pick<EventBody, "extra">): boolean => body.extra.some((line) => /^STATUS:\s*CANCELLED\s*$/i.test(line));

export function stampNow(now: Date = new Date()): string {
  return `${toBasicDay(now.toISOString().slice(0, 10))}T${now.toISOString().slice(11, 19).replaceAll(":", "")}Z`;
}

export function cleanName(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME);
}

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

// ---- Writing ------------------------------------------------------------------

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

/** A new UID for an event made here. */
export const newUid = (): string => `${crypto.randomUUID()}@dashi.calendar`;
