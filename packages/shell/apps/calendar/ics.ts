/**
 * iCalendar (RFC 5545), the subset Calendar writes and reads strictly.
 *
 * Written: VCALENDAR with X-WR-CALNAME and X-APPLE-CALENDAR-COLOR; VEVENT with
 * UID, DTSTAMP, DTSTART and DTEND (a date for an all-day event, else a
 * floating local time), SUMMARY, LOCATION, DESCRIPTION, RRULE (FREQ, INTERVAL,
 * COUNT or UNTIL, BYDAY for weekly), EXDATE; and one display VALARM with a
 * relative TRIGGER. Lines are folded at 75 octets and end in CRLF.
 *
 * Time zones: every event is kept as floating local time, the wall clock the
 * person sees. A time read with a UTC ("Z") or TZID zone is converted to the
 * wall clock of the computer's zone when it is read (a zone name this computer
 * does not know is taken as local time), and the file is written back
 * floating. VTIMEZONE components are therefore dropped.
 *
 * Read strictly: an event without a UID or a readable DTSTART, with a repeated
 * single-valued property, or with a RECURRENCE-ID is not shown. Nothing that
 * is not understood is lost, though: such events, other components (to-dos),
 * unknown properties, and alarms Calendar does not edit are kept as written
 * and written back.
 */

import { addMinutes, dayPart, fromBasicDay, fromBasicLocal, localOf, toBasicDay, toBasicLocal } from "./dates.ts";
import { type CalEvent, CalendarError, FREQUENCIES, type Frequency, type IcsFile, type Repeat } from "./types.ts";

export const MAX_ICS_BYTES = 4 * 1024 * 1024;
export const MAX_EVENTS = 20_000;
const MAX_NAME = 100;
const PRODID = "-//Dashi//Calendar//EN";

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

// ---- Content lines -------------------------------------------------------

export interface ContentLine {
  /** Upper case. */
  name: string;
  /** Upper-cased parameter names, values without quotes. */
  params: Map<string, string>;
  value: string;
  /** The unfolded line as written. */
  raw: string;
}

/** The text with folded lines joined; CRLF, LF, and CR all end a line. */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length > 0) out[out.length - 1] += line.slice(1);
    else out.push(line);
  }
  return out.filter((line) => line !== "");
}

/** One content line, or null when it has no name or no colon. */
export function parseLine(raw: string): ContentLine | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') quoted = !quoted;
    else if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const head = raw.slice(0, colon);
  const parts: string[] = [];
  let start = 0;
  quoted = false;
  for (let i = 0; i <= head.length; i++) {
    const char = head[i];
    if (char === '"') quoted = !quoted;
    else if ((char === ";" && !quoted) || i === head.length) {
      parts.push(head.slice(start, i));
      start = i + 1;
    }
  }
  const name = (parts[0] ?? "").toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) return null;
  const params = new Map<string, string>();
  for (const part of parts.slice(1)) {
    const equals = part.indexOf("=");
    if (equals > 0) params.set(part.slice(0, equals).toUpperCase(), part.slice(equals + 1).replace(/^"|"$/g, ""));
  }
  return { name, params, value: raw.slice(colon + 1), raw };
}

export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_all, char: string) => (char === "n" || char === "N" ? "\n" : char));
}

export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const encoder = new TextEncoder();

/** A content line as physical lines of at most 75 octets (a character is never split). */
export function fold(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      out.push(current);
      current = " ";
      size = 1;
      limit = 75;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out;
}

// ---- Times -----------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat | null>();

function zoneFormatter(zone: string): Intl.DateTimeFormat | null {
  if (!/^[A-Za-z0-9_+\-/]{1,64}$/.test(zone)) return null;
  let found = formatters.get(zone);
  if (found === undefined) {
    try {
      found = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      found = null;
    }
    formatters.set(zone, found);
  }
  return found;
}

function zoneOffset(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** The wall clock of this computer's zone at the instant a time in `zone` is, or null when the zone is unknown. */
export function zonedToLocal(wall: string, zone: string): string | null {
  const formatter = zoneFormatter(zone);
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(wall);
  if (!formatter || !match) return null;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  const first = zoneOffset(formatter, guess);
  let instant = guess - first;
  const second = zoneOffset(formatter, instant);
  if (second !== first) instant = guess - second;
  return localOf(new Date(instant));
}

export interface ParsedTime {
  local: string;
  allDay: boolean;
}

/** A DTSTART, DTEND, or EXDATE value as a wall-clock time; null when it is not one Calendar can read. */
export function parseTime(line: Pick<ContentLine, "params" | "value">, value = line.value): ParsedTime | null {
  const text = value.trim();
  if (line.params.get("VALUE")?.toUpperCase() === "DATE" || /^\d{8}$/.test(text)) {
    const day = fromBasicDay(text);
    return day === null ? null : { local: `${day}T00:00`, allDay: true };
  }
  const utc = /^(\d{8}T\d{6})Z$/.exec(text);
  if (utc) {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(utc[1] ?? "");
    if (!match || fromBasicLocal(utc[1] ?? "") === null) return null;
    return {
      local: localOf(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])))),
      allDay: false,
    };
  }
  const local = fromBasicLocal(text);
  if (local === null) return null;
  const zone = line.params.get("TZID");
  if (zone) {
    const converted = zonedToLocal(text, zone);
    if (converted !== null) return { local: converted, allDay: false };
  }
  return { local, allDay: false };
}

/** An RFC 5545 duration as minutes (negative for "-"), or null. Seconds are dropped. */
export function parseDuration(text: string): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text.trim());
  if (!match || text.trim().replace(/^[+-]?P/, "") === "" || /T$/.test(text.trim())) return null;
  const [, sign, weeks, days, hours, minutes] = match;
  const total = Number(weeks ?? 0) * 10_080 + Number(days ?? 0) * 1440 + Number(hours ?? 0) * 60 + Number(minutes ?? 0);
  return sign === "-" ? -total : total;
}

/** Minutes as a duration: 90 is "PT1H30M", 1440 is "P1D"; negative has a leading "-". */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(Math.round(minutes));
  if (total === 0) return "PT0S";
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const rest = total % 60;
  const time = `${hours > 0 ? `${hours}H` : ""}${rest > 0 ? `${rest}M` : ""}`;
  return `${sign}P${days > 0 ? `${days}D` : ""}${time ? `T${time}` : ""}`;
}

// ---- Repeat rules -----------------------------------------------------------

/** The rule as a Repeat, or null when it uses anything Calendar does not edit. */
export function parseRule(value: string): Repeat | null {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const equals = part.indexOf("=");
    if (equals <= 0) return null;
    const key = part.slice(0, equals).toUpperCase();
    if (fields.has(key)) return null;
    fields.set(key, part.slice(equals + 1));
  }
  const allowed = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY", "WKST"]);
  if ([...fields.keys()].some((key) => !allowed.has(key))) return null;
  const freq = fields.get("FREQ")?.toLowerCase();
  if (!(FREQUENCIES as readonly string[]).includes(freq ?? "")) return null;
  const repeat: Repeat = { freq: freq as Frequency, interval: 1 };
  const interval = fields.get("INTERVAL");
  if (interval !== undefined) {
    if (!/^\d{1,3}$/.test(interval) || Number(interval) < 1) return null;
    repeat.interval = Number(interval);
  }
  if (fields.has("COUNT") && fields.has("UNTIL")) return null;
  const count = fields.get("COUNT");
  if (count !== undefined) {
    if (!/^\d{1,4}$/.test(count) || Number(count) < 1) return null;
    repeat.count = Number(count);
  }
  const until = fields.get("UNTIL");
  if (until !== undefined) {
    const day = /^\d{8}$/.test(until) ? fromBasicDay(until) : (parseTime({ params: new Map(), value: until })?.local.slice(0, 10) ?? null);
    if (day === null) return null;
    repeat.until = day;
  }
  const byDay = fields.get("BYDAY");
  if (byDay !== undefined) {
    if (repeat.freq !== "weekly") return null;
    const days = byDay.split(",").map((token) => WEEKDAYS.indexOf(token.toUpperCase() as (typeof WEEKDAYS)[number]));
    if (days.length === 0 || days.some((index) => index < 0)) return null;
    repeat.byDay = [...new Set(days)].sort((a, b) => a - b);
  }
  const wkst = fields.get("WKST");
  if (wkst !== undefined && wkst.toUpperCase() !== "MO") return null;
  return repeat;
}

export function formatRule(repeat: Repeat, allDay: boolean): string {
  const parts = [`FREQ=${repeat.freq.toUpperCase()}`];
  if (repeat.interval > 1) parts.push(`INTERVAL=${repeat.interval}`);
  if (repeat.freq === "weekly" && repeat.byDay && repeat.byDay.length > 0) parts.push(`BYDAY=${repeat.byDay.map((index) => WEEKDAYS[index]).join(",")}`);
  if (repeat.count !== undefined) parts.push(`COUNT=${repeat.count}`);
  else if (repeat.until !== undefined) parts.push(`UNTIL=${allDay ? toBasicDay(repeat.until) : `${toBasicDay(repeat.until)}T235959`}`);
  return parts.join(";");
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

/** One VEVENT as an event, or the reason it cannot be shown. */
function readEvent(component: Component): CalEvent | string {
  const single = new Map<string, ContentLine>();
  const exdateLines: ContentLine[] = [];
  const extra: string[] = [];
  const modeled = new Set(["UID", "DTSTART", "DTEND", "DURATION", "SUMMARY", "LOCATION", "DESCRIPTION", "RRULE", "DTSTAMP"]);
  for (const line of component.lines) {
    if (line.name === "RECURRENCE-ID") return "it changes one occurrence of a repeating event";
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
    end = parsed.local;
  } else if (durationLine) {
    const minutes = parseDuration(durationLine.value);
    if (minutes === null || minutes < 0) return "its duration is not one Calendar reads";
    end = addMinutes(start.local, minutes);
  } else {
    end = start.allDay ? addMinutes(start.local, 1440) : start.local;
  }
  if (end < start.local) return "it ends before it starts";
  if (start.allDay && end === start.local) end = addMinutes(start.local, 1440);
  const ruleLine = single.get("RRULE");
  const repeat = ruleLine ? parseRule(ruleLine.value) : null;
  const exdates: string[] = [];
  for (const line of exdateLines) {
    for (const part of line.value.split(",")) {
      const parsed = parseTime(line, part);
      if (!parsed) return "an EXDATE is not one Calendar reads";
      exdates.push(parsed.local);
    }
  }
  const alarm = alarmOf(component.children);
  return {
    uid,
    title: unescapeText(single.get("SUMMARY")?.value ?? ""),
    allDay: start.allDay,
    start: start.local,
    end,
    location: unescapeText(single.get("LOCATION")?.value ?? ""),
    notes: unescapeText(single.get("DESCRIPTION")?.value ?? ""),
    repeat,
    rawRule: ruleLine && !repeat ? ruleLine.value : null,
    exdates,
    alert: alarm.alert,
    stamp: /^\d{8}T\d{6}Z$/.test(single.get("DTSTAMP")?.value.trim() ?? "") ? (single.get("DTSTAMP")?.value.trim() as string) : stampNow(),
    extra,
    rawAlarms: alarm.rawAlarms,
  };
}

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

/** An .ics file's text as what Calendar understands of it; throws a CalendarError when it is not an iCalendar file at all. */
export function parseIcs(text: string): IcsFile {
  if (text.length > MAX_ICS_BYTES * 2) throw new CalendarError("That file is too large to be a calendar.");
  const root = parseComponents(unfold(text.replace(/^﻿/, "")));
  const calendars = root.children;
  if (calendars.length !== 1 || calendars[0]?.name !== "VCALENDAR") throw new CalendarError("Not an iCalendar file: it has no single VCALENDAR.");
  const calendar = calendars[0];
  const file: IcsFile = { name: null, color: null, events: [], headerExtra: [], preserved: [], problems: [] };
  for (const line of calendar.lines) {
    if (line.name === "X-WR-CALNAME" || (line.name === "NAME" && file.name === null)) file.name = cleanName(unescapeText(line.value)) || null;
    else if (line.name === "X-APPLE-CALENDAR-COLOR" || (line.name === "COLOR" && file.color === null)) {
      const color = line.value.trim();
      if (isColor(color) || /^#[0-9a-fA-F]{8}$/.test(color)) file.color = color.slice(0, 7).toLowerCase();
      else if (line.name === "X-APPLE-CALENDAR-COLOR") file.headerExtra.push(line.raw);
    } else if (line.name === "VERSION" || line.name === "PRODID" || line.name === "CALSCALE") continue;
    else file.headerExtra.push(line.raw);
  }
  const seen = new Set<string>();
  for (const child of calendar.children) {
    if (child.name === "VTIMEZONE") continue;
    if (child.name !== "VEVENT") {
      file.preserved.push(...child.raw);
      continue;
    }
    const read = readEvent(child);
    if (typeof read === "string") {
      const title = child.lines.find((line) => line.name === "SUMMARY")?.value ?? "";
      file.problems.push(`An event${title ? ` (“${unescapeText(title).slice(0, 40)}”)` : ""} is kept but not shown: ${read}.`);
      file.preserved.push(...child.raw);
    } else if (seen.has(read.uid)) {
      file.problems.push(`An event (“${read.title.slice(0, 40)}”) is kept but not shown: its UID is used twice.`);
      file.preserved.push(...child.raw);
    } else {
      seen.add(read.uid);
      file.events.push(read);
      if (file.events.length > MAX_EVENTS) throw new CalendarError("That calendar has too many events.");
    }
  }
  return file;
}

// ---- Writing ------------------------------------------------------------------

function timeProperty(name: string, local: string, allDay: boolean): string {
  return allDay ? `${name};VALUE=DATE:${toBasicDay(dayPart(local))}` : `${name}:${toBasicLocal(local)}`;
}

function writeEvent(event: CalEvent): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeUid(event.uid)}`,
    `DTSTAMP:${event.stamp}`,
    timeProperty("DTSTART", event.start, event.allDay),
    timeProperty("DTEND", event.end, event.allDay),
    `SUMMARY:${escapeText(event.title)}`,
  ];
  if (event.location !== "") lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.notes !== "") lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
  if (event.repeat) lines.push(`RRULE:${formatRule(event.repeat, event.allDay)}`);
  else if (event.rawRule !== null) lines.push(`RRULE:${event.rawRule}`);
  for (const exdate of event.exdates) lines.push(timeProperty("EXDATE", exdate, event.allDay));
  lines.push(...event.extra);
  if (event.alert !== null)
    lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(event.title || "Event")}`, `TRIGGER:${formatDuration(-event.alert)}`, "END:VALARM");
  lines.push(...event.rawAlarms, "END:VEVENT");
  return lines;
}

/** A UID is written as is except for characters that would end the line. */
const escapeUid = (uid: string): string => uid.replace(/[\u0000-\u001f\u007f]/g, "");

/** The file's text: CRLF lines folded at 75 octets. */
export function writeIcs(file: Pick<IcsFile, "events" | "headerExtra" | "preserved"> & { name: string; color: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(cleanName(file.name))}`,
    `X-APPLE-CALENDAR-COLOR:${file.color}`,
    ...file.headerExtra,
  ];
  for (const event of file.events) lines.push(...writeEvent(event));
  lines.push(...file.preserved, "END:VCALENDAR");
  return `${lines.flatMap(fold).join("\r\n")}\r\n`;
}

/** A new UID for an event made here. */
export const newUid = (): string => `${crypto.randomUUID()}@dashi.calendar`;
