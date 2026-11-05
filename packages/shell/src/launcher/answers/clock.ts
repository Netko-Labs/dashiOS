/**
 * Times in other places: "time in lisbon" (now there), "3pm tokyo" (that time
 * there, here), "3pm lisbon in tokyo" (from one place to another). The
 * clock is written as the Region and the 24-hour choice write it.
 */

import { dayDifference, fold, instantAt, offsetMinutes, zoneNamed } from "./zones.ts";

export interface ClockContext {
  locale: string;
  hour24?: boolean;
  /** The zone "here" is. */
  timeZone: string;
  now: number;
}

export interface ClockAnswer {
  title: string;
  detail: string;
  copy: string;
}

const NOW = [/^(?:what\s+)?(?:time|now)\s+(?:is\s+it\s+)?(?:in|at)\s+(.+)$/, /^time\s+(.+)$/, /^(.+?)\s+time$/];
/** `3pm`, `3:30 pm`, `15:00`, `noon`, then a place, then maybe `in`/`to` another. */
const AT = /^(?:(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?|(noon|midday|midnight))\s+(?:in\s+|at\s+)?(.+)$/;

const formats = new Map<string, Intl.DateTimeFormat>();

function time(instant: number, zone: string, context: ClockContext): string {
  const key = `${context.locale}|${context.hour24}|${zone}`;
  let format = formats.get(key);
  if (!format) {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      ...(context.hour24 === undefined ? {} : { hourCycle: context.hour24 ? "h23" : "h12" }),
    };
    try {
      format = new Intl.DateTimeFormat(context.locale, options);
    } catch {
      format = new Intl.DateTimeFormat("en-US", options);
    }
    formats.set(key, format);
  }
  return format.format(instant);
}

/** "same time as here", "1 h ahead", "5 h 30 min behind". */
export function aheadOf(minutes: number): string {
  if (minutes === 0) return "same time as here";
  const size = Math.abs(minutes);
  const hours = Math.floor(size / 60);
  const rest = size % 60;
  const span = [hours > 0 ? `${hours} h` : "", rest > 0 ? `${rest} min` : ""].filter(Boolean).join(" ");
  return `${span} ${minutes > 0 ? "ahead" : "behind"}`;
}

const dayNote = (days: number): string => (days > 0 ? ", the next day" : days < 0 ? ", the day before" : "");

/** The 24-hour hour for a typed clock; null when it isn't one (13pm, 25:00). */
function hourOf(hourText: string, meridiem: string | undefined): number | null {
  const hour = Number(hourText);
  if (!meridiem) return hour <= 23 ? hour : null;
  if (hour < 1 || hour > 12) return null;
  const pm = meridiem.startsWith("p");
  return (hour % 12) + (pm ? 12 : 0);
}

/** A place and, after ` in ` or ` to `, maybe another: the first split that names zones. */
function places(text: string): { from: NonNullable<ReturnType<typeof zoneNamed>>; to: ReturnType<typeof zoneNamed> } | null {
  const whole = zoneNamed(text);
  if (whole) return { from: whole, to: null };
  for (const match of text.matchAll(/\s+(?:in|to)\s+/g)) {
    const from = zoneNamed(text.slice(0, match.index));
    const to = zoneNamed(text.slice((match.index ?? 0) + match[0].length));
    if (from && to) return { from, to };
  }
  return null;
}

/** The answer for a time query, or null when `query` isn't one. */
export function clockAnswer(query: string, context: ClockContext): ClockAnswer | null {
  const text = fold(query);
  if (!/\d|time|now|noon|midday|midnight/.test(text)) return null;
  for (const pattern of NOW) {
    const place = pattern.exec(text)?.[1];
    const named = place ? zoneNamed(place) : null;
    if (!named) continue;
    const shown = time(context.now, named.zone, context);
    const ahead = offsetMinutes(context.now, named.zone) - offsetMinutes(context.now, context.timeZone);
    const days = dayDifference(context.now, context.timeZone, named.zone);
    return { title: `${shown} in ${named.place}`, detail: `${aheadOf(ahead)}${dayNote(days)}`, copy: shown };
  }
  const at = AT.exec(text);
  if (!at) return null;
  const [, hourText, minuteText, meridiem, word, rest] = at;
  // A bare number is not a time ("5 tokyo"): it needs am/pm, minutes, or a word.
  if (hourText !== undefined && !meridiem && minuteText === undefined) return null;
  const hour = word ? (word === "midnight" ? 0 : 12) : hourOf(hourText ?? "", meridiem);
  const minute = Number(minuteText ?? 0);
  if (hour === null || minute > 59) return null;
  const where = places(rest ?? "");
  if (!where) return null;
  const instant = instantAt(context.now, where.from.zone, hour, minute);
  const target = where.to?.zone ?? context.timeZone;
  const shown = time(instant, target, context);
  const days = dayDifference(instant, where.from.zone, target);
  return {
    title: where.to ? `${shown} in ${where.to.place}` : `${shown} here`,
    detail: `${time(instant, where.from.zone, context)} in ${where.from.place}${dayNote(days)}`,
    copy: shown,
  };
}
