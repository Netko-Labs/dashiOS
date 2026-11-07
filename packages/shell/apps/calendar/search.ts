/**
 * Edit › Find: the events whose title, place, or notes have every word typed,
 * within a year either side of today, the coming ones first (soonest first),
 * then the past ones (latest first). Pure.
 */

import { addDays, type Day, dayPart } from "./dates.ts";
import { occurrencesOf } from "./recurrence.ts";
import type { CalEvent, Calendar, Occurrence } from "./types.ts";

export const SEARCH_LIMIT = 40;
const REACH_DAYS = 366;

const wordsOf = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");

const says = (event: Pick<CalEvent, "title" | "location" | "notes">, words: readonly string[]): boolean => {
  const text = `${event.title}\n${event.location}\n${event.notes}`.toLowerCase();
  return words.every((word) => text.includes(word));
};

export function searchEvents(
  calendars: readonly Pick<Calendar, "id" | "events">[],
  hidden: readonly string[],
  query: string,
  today: Day,
  limit = SEARCH_LIMIT,
): Occurrence[] {
  const words = wordsOf(query);
  if (words.length === 0) return [];
  const from = `${addDays(today, -REACH_DAYS)}T00:00`;
  const to = `${addDays(today, REACH_DAYS)}T00:00`;
  const found: Occurrence[] = [];
  for (const calendar of calendars) {
    if (hidden.includes(calendar.id)) continue;
    for (const event of calendar.events) {
      if (!says(event, words) && !event.overrides.some((override) => says(override, words))) continue;
      for (const occurrence of occurrencesOf(event, calendar.id, from, to)) if (says(occurrence.event, words)) found.push(occurrence);
    }
  }
  const isComing = (each: Occurrence): boolean => dayPart(each.end > each.start ? each.end : each.start) >= today;
  const coming = found.filter(isComing).sort((a, b) => (a.start < b.start ? -1 : 1));
  const past = found.filter((each) => !isComing(each)).sort((a, b) => (a.start > b.start ? -1 : 1));
  return [...coming, ...past].slice(0, limit);
}
