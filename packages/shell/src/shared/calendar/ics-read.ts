/**
 * Reads VEVENTs into events (ics.ts reads the file around them): the times,
 * words, repeat rule and exceptions of each, the one display alarm Calendar
 * edits and the alarms it keeps as written, and what makes an event
 * unreadable. A changed occurrence is read the same way, then joined to its
 * repeat by ics.ts.
 */

import { addMinutes } from "./dates.ts";
import type { Component } from "./ics-components.ts";
import { type ContentLine, parseDuration, unescapeText } from "./ics-lines.ts";
import { inEventZone, type ParsedTime, parseTime, stampNow } from "./ics-time.ts";
import { parseRule } from "./rules.ts";
import type { CalEvent, EventBody } from "./types.ts";

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
export interface ReadEvent {
  uid: string;
  body: EventBody;
  rule: string | null;
  exdates: ParsedTime[];
  /** Set on a changed occurrence of a repeat. */
  recurrenceId: ParsedTime | null;
}

/** One VEVENT, or the reason it cannot be shown. */
export function readEvent(component: Component): ReadEvent | string {
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
export function eventOf(read: ReadEvent): CalEvent {
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
