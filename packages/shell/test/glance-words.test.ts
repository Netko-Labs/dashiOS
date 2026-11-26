/**
 * Glance folds Today into words (LK-3, lock-v3 `c-glance`): the installed pass saw the clock alone, though
 * tomorrow's event was in Up next. The next event is its figure line; within the hour and a half it is a
 * fact too.
 */

import { expect, test } from "bun:test";
import type { Occurrence } from "../src/shared/calendar/index.ts";
import { glanceNext } from "../src/widgets/lib/glance-words.ts";

const event = (title: string, start: string, allDay = false): Occurrence => ({
  event: { uid: title, title, allDay, start, end: start } as unknown as Occurrence["event"],
  calendarId: "Work",
  start,
  end: start,
  recurrenceId: null,
});

const now = new Date(2026, 10, 25, 16, 48).getTime();

test("the next event is Glance's figure line, and in words while it is near", () => {
  const day = [event("Holiday", "2026-11-25", true), event("Lunch", "2026-11-25T12:00"), event("Design review: glass", "2026-11-25T17:00")];
  expect(glanceNext(day, now, false, true)).toEqual({ figure: "5:00", words: "PM · Design review: glass", soon: "Design review in 12 min" });
  expect(glanceNext(day, now, true, true)).toEqual({ figure: "17:00", words: "Design review: glass", soon: "Design review in 12 min" });
});

test("tomorrow's event is the figure line with no fact; nothing ahead, no line", () => {
  expect(glanceNext([event("Standup", "2026-11-26T10:00")], now, false, true)).toEqual({ figure: "10:00", words: "AM · Standup", soon: null });
  expect(glanceNext([], now, false, true)).toBeNull();
});

test("where the person hid their events on the lock, Glance names none", () => {
  const next = glanceNext([event("Design review: glass", "2026-11-25T17:00")], now, false, false);
  expect(next).toEqual({ figure: "5:00", words: "PM", soon: "Next event in 12 min" });
});
