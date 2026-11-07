import { expect, test } from "bun:test";
import { isDrag, monthDayAt, previewOf } from "../apps/calendar/drag.ts";
import { makeEvent } from "../apps/calendar/event.ts";
import { pendingInput } from "../apps/calendar/grid-edits.ts";
import { HOUR_HEIGHT } from "../apps/calendar/layout.ts";
import { calendarMenus, type MenuContext } from "../apps/calendar/menus.ts";
import { parseQuickAdd } from "../apps/calendar/quickadd.ts";
import { searchEvents } from "../apps/calendar/search.ts";
import { dateOrder, formatDayText, parseDayText, parseTimeText } from "../apps/calendar/timetext.ts";
import type { Occurrence } from "../apps/calendar/types.ts";
import { keyAction } from "../apps/calendar/window-keys.ts";
import { reservedBy } from "../src/app-menus/reserved.ts";
import { chordFromShortcut } from "../src/app-menus/shortcut.ts";

const TODAY = "2026-11-05"; // a Thursday

test("quick add reads when from the end of a title", () => {
  expect(parseQuickAdd("Lunch with Mei 12:30", TODAY)).toEqual({ title: "Lunch with Mei", start: 750 });
  expect(parseQuickAdd("Dentist Tue 3pm every 6 months", TODAY)).toEqual({
    title: "Dentist",
    day: "2026-11-10",
    start: 900,
    repeat: { freq: "monthly", interval: 6 },
  });
  expect(parseQuickAdd("Standup 9:30-9:45 weekdays", TODAY)).toEqual({
    title: "Standup",
    start: 570,
    end: 585,
    repeat: { freq: "weekly", interval: 1, byDay: [1, 2, 3, 4, 5] },
  });
  expect(parseQuickAdd("Trip tomorrow all day", TODAY)).toEqual({ title: "Trip", day: "2026-11-06", allDay: true });
  expect(parseQuickAdd("Coffee 3-4pm", TODAY)).toMatchObject({ title: "Coffee", start: 900, end: 960 });
  // A number alone is part of the title; "at" makes it a time (3 PM in a 12-hour region).
  expect(parseQuickAdd("Room 3", TODAY)).toEqual({ title: "Room 3" });
  expect(parseQuickAdd("Call Mom at 3", TODAY, true)).toEqual({ title: "Call Mom", start: 900 });
  expect(parseQuickAdd("Yoga every thursday", TODAY)).toEqual({ title: "Yoga", day: TODAY, repeat: { freq: "weekly", interval: 1, byDay: [4] } });
});

test("a named new event takes what quick add read", () => {
  const pending = { calendarId: "Home", start: "2026-11-05T10:00", end: "2026-11-05T11:30", allDay: false, title: "Lunch tomorrow 12:30" };
  expect(pendingInput(pending, TODAY, true)).toEqual({ title: "Lunch", allDay: false, start: "2026-11-06T12:30", end: "2026-11-06T14:00", alert: null });
  const allDay = { ...pending, start: "2026-11-05T00:00", end: "2026-11-06T00:00", allDay: true, title: "Party 8pm" };
  expect(pendingInput(allDay, TODAY, true)).toMatchObject({ allDay: false, start: "2026-11-05T20:00", end: "2026-11-05T21:00" });
});

test("times and days as the region writes them", () => {
  expect(parseTimeText("3")).toBe(180);
  expect(parseTimeText("3", true)).toBe(900);
  expect(parseTimeText("7", true)).toBe(420);
  expect(parseTimeText("3 am", true)).toBe(180);
  expect(parseTimeText("noon")).toBe(720);
  expect(dateOrder("en-US")).toBe("mdy");
  expect(dateOrder("de-DE")).toBe("dmy");
  expect(parseDayText("11/5/2026", "mdy")).toBe("2026-11-05");
  expect(parseDayText("5.11.2026", "dmy")).toBe("2026-11-05");
  expect(parseDayText("5.11.", "dmy", 2027)).toBe("2027-11-05");
  expect(parseDayText("2026-11-05", "dmy")).toBe("2026-11-05");
  expect(parseDayText("31/2/2026", "dmy")).toBeNull();
  expect(formatDayText("2026-11-05", "de-DE")).toBe("5.11.2026");
});

const occurrence = (start: string, end: string, allDay = false): Occurrence => ({
  event: makeEvent({ title: "Review", allDay, start, end }),
  calendarId: "Home",
  start,
  end,
  recurrenceId: null,
});
const week = { days: ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"], columnWidth: 100 };

test("a drag's times snap to 15 minutes, and stay inside the days shown", () => {
  expect(isDrag(2, 2)).toBe(false);
  expect(isDrag(0, 6)).toBe(true);
  // Drawing from 10:05 up to 9:20 makes 9:15 to 10:15.
  const create = { kind: "create" as const, x: 0, y: 0, day: "2026-11-05", minutes: 605 };
  expect(previewOf(create, 0, -HOUR_HEIGHT * 0.75, week)).toEqual({ start: "2026-11-05T09:15", end: "2026-11-05T10:15", allDay: false });
  const review = occurrence("2026-11-05T09:10", "2026-11-05T10:10");
  // Two columns right and 20 minutes down: the start snaps to 9:30 on Saturday.
  expect(previewOf({ kind: "move", x: 0, y: 0, day: "2026-11-05", occurrence: review }, 200, (HOUR_HEIGHT * 20) / 60, week)).toEqual({
    start: "2026-11-07T09:30",
    end: "2026-11-07T10:30",
    allDay: false,
  });
  // Far right is still Saturday, the last day shown.
  expect(previewOf({ kind: "move", x: 0, y: 0, day: "2026-11-05", occurrence: review }, 900, 0, week)?.start).toBe("2026-11-07T09:15");
  // Stretched up past its start, it keeps 15 minutes.
  expect(previewOf({ kind: "resize", x: 0, y: 0, day: "2026-11-05", occurrence: review }, 0, -HOUR_HEIGHT * 3, week)?.end).toBe("2026-11-05T09:25");
  // An all-day chip dragged in the month lands on the day under the pointer.
  const month = [week.days, week.days.map((day) => day.replace("-0", "-1"))];
  const dayAt = (x: number, y: number) => monthDayAt({ x: 0, y: 0, width: 700, height: 200 }, month, x, y);
  const party = occurrence("2026-11-05T00:00", "2026-11-07T00:00", true);
  expect(previewOf({ kind: "move-days", x: 450, y: 50, day: "2026-11-05", occurrence: party }, -300, 0, { ...week, dayAt })).toEqual({
    start: "2026-11-02T00:00",
    end: "2026-11-04T00:00",
    allDay: true,
  });
});

test("the window's keys", () => {
  const key = (name: string, text?: string) => ({ key: name, ...(text ? { text } : {}), ctrl: false, alt: false, meta: false });
  expect(keyAction(key("left"), "month")).toEqual({ kind: "move", days: -1 });
  expect(keyAction(key("down"), "week")).toEqual({ kind: "move", days: 7 });
  expect(keyAction(key("down"), "day")).toEqual({ kind: "move", days: 1 });
  expect(keyAction(key("backspace"), "day")).toEqual({ kind: "delete" });
  expect(keyAction(key("n", "n"), "day")).toEqual({ kind: "new" });
  expect(keyAction({ ...key("n", "n"), meta: true }, "day")).toBeNull();
});

test("the menus' chords are free for the app, and nothing runs behind a sheet", () => {
  const ran: string[] = [];
  const actions = new Proxy({}, { get: (_target, name) => () => ran.push(String(name)) }) as MenuContext["actions"];
  const undo = { canUndo: true, canRedo: false, undoName: "Move Event", redoName: null, busy: false, undoStep: 1 };
  const { menus, run } = calendarMenus({ view: "week", modal: false, picked: true, undo, actions });
  for (const row of menus.flatMap((menu) => menu.items)) {
    const shortcut = "shortcut" in row ? row.shortcut : undefined;
    const chord = shortcut ? chordFromShortcut(shortcut) : null;
    if (chord) expect(reservedBy(chord)).toBeNull();
  }
  expect(menus.flatMap((menu) => menu.items).find((row) => "id" in row && row.id === "undo")).toMatchObject({ label: "Undo Move Event" });
  run("event:duplicate");
  run("delete");
  expect(ran).toEqual(["duplicate", "deleteEvent"]);
  calendarMenus({ view: "week", modal: true, picked: true, undo, actions }).run("delete");
  expect(ran).toEqual(["duplicate", "deleteEvent"]);
});

test("Find has every word, coming events first", () => {
  const calendars = [
    {
      id: "Home",
      events: [
        makeEvent({ title: "Dentist", allDay: false, start: "2026-10-01T15:00", end: "2026-10-01T16:00", location: "Main St" }),
        makeEvent({ title: "Dentist again", allDay: false, start: "2026-12-01T15:00", end: "2026-12-01T16:00", location: "Main St" }),
        makeEvent({ title: "Lunch", allDay: false, start: "2026-11-06T12:00", end: "2026-11-06T13:00" }),
      ],
    },
  ];
  expect(searchEvents(calendars, [], "dentist main", TODAY).map((each) => each.event.title)).toEqual(["Dentist again", "Dentist"]);
  expect(searchEvents(calendars, ["Home"], "dentist", TODAY)).toEqual([]);
  expect(searchEvents(calendars, [], "  ", TODAY)).toEqual([]);
});
