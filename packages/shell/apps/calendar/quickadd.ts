/**
 * Quick add: the words after a new event's title that say when it is, read
 * from the end of what was typed in place: "Lunch with Mei 12:30",
 * "Dentist Tue 3pm every 6 months", "Standup 9:30-9:45 weekdays", "Trip
 * tomorrow all day". English words; times as timetext.ts reads them (a time
 * needs a colon, AM or PM, or "at"). What is not read stays in the title. Pure.
 */

import { addDays, type Day, weekday } from "./dates.ts";
import { parseTimeText } from "./timetext.ts";
import type { Frequency, Repeat } from "./types.ts";

export interface QuickAdd {
  title: string;
  day?: Day;
  /** Minutes after midnight. */
  start?: number;
  end?: number;
  allDay?: boolean;
  repeat?: Repeat;
}

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DAY_WORD = "(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|sday|urday)?";
const TIME = "(\\d{1,2}(?:[:.]\\d{2})?\\s*(?:[ap]\\.?m?\\.?)?|noon|midnight)";
const UNITS: Readonly<Record<string, Frequency>> = { day: "daily", week: "weekly", month: "monthly", year: "yearly" };
const EVERY: Readonly<Record<string, Frequency>> = { daily: "daily", weekly: "weekly", monthly: "monthly", yearly: "yearly", annually: "yearly" };

const dayIndex = (word: string): number => DAYS.indexOf(word.slice(0, 3).toLowerCase() as (typeof DAYS)[number]);

/** The next `index` weekday on or after `today`. */
const nextWeekday = (today: Day, index: number): Day => addDays(today, (index - weekday(today) + 7) % 7);

/** A time with AM or PM, a colon, or said "at": "3" alone is not a time ("Room 3"). */
function readTime(text: string, spoken: boolean, hour12: boolean): number | null {
  const clear = spoken || /[:.]|[ap]/i.test(text) || /^(noon|midnight)$/i.test(text.trim());
  return clear ? parseTimeText(text, hour12) : null;
}

/** What `text` says, `today` being the day "tomorrow" counts from; `hour12` reads a bare "3" as 3 PM. */
export function parseQuickAdd(text: string, today: Day, hour12 = false): QuickAdd {
  let rest = text.trim();
  const out: QuickAdd = { title: rest };
  const take = (pattern: RegExp): RegExpExecArray | null => {
    const match = pattern.exec(rest);
    if (match) rest = rest.slice(0, match.index).trimEnd();
    return match;
  };
  for (let guard = 0; guard < 6; guard++) {
    let match: RegExpExecArray | null;
    if (!out.repeat && (match = take(/(?:^|\s)every\s+(\d{1,3}\s+)?(day|week|month|year)s?$/i))) {
      out.repeat = { freq: UNITS[(match[2] ?? "").toLowerCase()] ?? "weekly", interval: Math.max(1, Number(match[1] ?? 1)) };
    } else if (!out.repeat && (match = take(/(?:^|\s)(daily|weekly|monthly|yearly|annually)$/i))) {
      out.repeat = { freq: EVERY[(match[1] ?? "").toLowerCase()] ?? "weekly", interval: 1 };
    } else if (!out.repeat && (match = take(/(?:^|\s)(?:every\s+)?weekdays$/i))) {
      out.repeat = { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] };
    } else if (!out.repeat && (match = take(new RegExp(`(?:^|\\s)every\\s+${DAY_WORD}$`, "i")))) {
      const index = dayIndex(match[1] ?? "");
      out.repeat = { freq: "weekly", interval: 1, byDay: [index] };
      out.day ??= nextWeekday(today, index);
    } else if (out.start === undefined && (match = take(new RegExp(`(?:^|\\s)(?:(at|from)\\s+)?${TIME}\\s*(?:-|–|to)\\s*${TIME}$`, "i")))) {
      const endText = match[3] ?? "";
      const endMeridiem = /[ap]/i.exec(endText)?.[0] ?? "";
      const startText = /[ap]/i.test(match[2] ?? "") || endMeridiem === "" ? (match[2] ?? "") : `${match[2]} ${endMeridiem}m`;
      const start = readTime(startText, true, hour12);
      const end = readTime(endText, true, hour12);
      if (start === null || end === null || end <= start) {
        rest = `${rest} ${match[0].trim()}`;
        break;
      }
      out.start = start;
      out.end = end;
    } else if (out.start === undefined && (match = take(new RegExp(`(?:^|\\s)(?:(at)\\s+)?${TIME}$`, "i")))) {
      const start = readTime(match[2] ?? "", match[1] !== undefined, hour12);
      if (start === null) {
        rest = `${rest} ${match[0].trim()}`;
        break;
      }
      out.start = start;
    } else if (out.allDay === undefined && take(/(?:^|\s)all[\s-]day$/i)) {
      out.allDay = true;
    } else if (out.day === undefined && (match = take(/(?:^|\s)(today|tonight|tomorrow)$/i))) {
      out.day = (match[1] ?? "").toLowerCase() === "tomorrow" ? addDays(today, 1) : today;
    } else if (out.day === undefined && (match = take(new RegExp(`(?:^|\\s)(?:on\\s+|next\\s+)?${DAY_WORD}$`, "i")))) {
      out.day = nextWeekday(today, dayIndex(match[1] ?? ""));
    } else break;
  }
  out.title = rest.replace(/\s+(at|on|from)$/i, "").trim();
  if (out.start !== undefined && out.allDay) delete out.allDay;
  return out;
}
