import { expect, test } from "bun:test";
import { sheetBodyRoom, sheetWidth } from "@dashi/ui";
import { CALENDAR_LEAST, CONTROLS_COMPACT, chromeFor, RAIL_WIDTH, SIDEBAR_FULL, toolbarRoom } from "../apps/calendar/lib/chrome.ts";
import { over } from "../apps/calendar/lib/colors.ts";
import { shortViewTitle, viewTitle } from "../apps/calendar/lib/format.ts";
import { blockParts, TIME_BESIDE_FROM } from "../apps/calendar/lib/grid/event-block.tsx";
import { placeDay, weekDays } from "../apps/calendar/lib/layout.ts";
import { popoverOrigin } from "../apps/calendar/lib/views/popover.tsx";
import { RESULTS_WIDTH, resultsPlace } from "../apps/calendar/lib/views/search-results.tsx";
import type { Occurrence } from "../src/shared/calendar/types.ts";

// Review 54: Calendar in a small, narrow or tiled window, and the week's overlapping events.

const prefs = { locale: "en-US", hour24: false, showDate: false };

const at = (title: string, start: string, end: string): Occurrence => ({
  event: {
    uid: title,
    title,
    allDay: false,
    start,
    end,
    location: "",
    notes: "",
    zone: null,
    alert: null,
    repeat: null,
    rawRule: null,
    exdates: [],
    overrides: [],
  } as unknown as Occurrence["event"],
  calendarId: "Work",
  start,
  end,
  recurrenceId: null,
});

const placedOn = (items: Occurrence[]) =>
  Object.fromEntries(placeDay(items, "2026-11-12").map((each) => [each.occurrence.event.title, [Number(each.left.toFixed(3)), Number(each.right.toFixed(3))]]));

test("a long event keeps the whole width outside the time it shares; the short one is drawn over it", () => {
  const placed = placedOn([at("Offsite", "2026-11-12T08:00", "2026-11-12T17:00"), at("Team standup", "2026-11-12T09:00", "2026-11-12T09:30")]);
  expect(placed.Offsite).toEqual([0, 1]);
  expect(placed["Team standup"]).toEqual([0.333, 1]);
  // Drawn after the one it covers, so it is on top.
  expect(
    placeDay([at("Team standup", "2026-11-12T09:00", "2026-11-12T09:30"), at("Offsite", "2026-11-12T08:00", "2026-11-12T17:00")], "2026-11-12").map(
      (each) => each.occurrence.event.title,
    ),
  ).toEqual(["Offsite", "Team standup"]);
});

test("events starting together sit side by side; a later one cascades over them", () => {
  const placed = placedOn([
    at("Design review", "2026-11-12T10:00", "2026-11-12T11:30"),
    at("Call with Alex Kim", "2026-11-12T10:30", "2026-11-12T11:00"),
    at("Budget", "2026-11-12T10:45", "2026-11-12T12:00"),
  ]);
  // Design review keeps its title in the full width at 10:00; the call (30 minutes later) is drawn over it, and Budget
  // (15 minutes after the call) shares the call's span beside it.
  expect(placed["Design review"]).toEqual([0, 1]);
  expect(placed["Call with Alex Kim"]).toEqual([0.333, 0.667]);
  expect(placed.Budget).toEqual([0.667, 1]);
  // Two that start at once split the width.
  const pair = placedOn([at("A", "2026-11-12T13:00", "2026-11-12T14:00"), at("B", "2026-11-12T13:15", "2026-11-12T13:45")]);
  expect(pair).toEqual({ A: [0, 0.5], B: [0.5, 1] });
  // Apart, each has the whole width.
  expect(placedOn([at("A", "2026-11-12T13:00", "2026-11-12T14:00"), at("B", "2026-11-12T14:00", "2026-11-12T15:00")])).toEqual({ A: [0, 1], B: [0, 1] });
});

test("a block shows its title first; the time only where there is room for both", () => {
  // A 30-minute block is one line: the time follows the title only in a wide block.
  expect(blockParts(TIME_BESIDE_FROM - 1, 23)).toEqual({ oneLine: true, time: false, place: false });
  expect(blockParts(TIME_BESIDE_FROM, 23).time).toBe(true);
  // A taller one puts the time under the title, and the place under that when it is an hour or more.
  expect(blockParts(80, 47)).toEqual({ oneLine: false, time: true, place: true });
  expect(blockParts(40, 47)).toEqual({ oneLine: false, time: false, place: false });
});

test("a block's fill is solid: the wash it had, laid on the window's ground", () => {
  expect(over("#3b82f6", 0.26, "#f5f5f7")).toBe("#c5d7f7");
  expect(over("#3b82f6", 0.26, "#000000")).toBe("#0f2240");
  expect(over("#3b82f6", 1, "#000000")).toBe("#3b82f6");
});

test("the window gives way in order: the rail, then one view pop-up, never a control", () => {
  expect(chromeFor(1097)).toEqual({ rail: false, sidebarWidth: SIDEBAR_FULL, compact: false });
  expect(chromeFor(700)).toEqual({ rail: false, sidebarWidth: SIDEBAR_FULL, compact: true });
  // Tiled to the left half of the VM's screen, and the least size.
  expect(chromeFor(539)).toEqual({ rail: true, sidebarWidth: RAIL_WIDTH, compact: true });
  expect(chromeFor(CALENDAR_LEAST.width)).toEqual({ rail: true, sidebarWidth: RAIL_WIDTH, compact: true });
  // At every width from the least up, the controls fit with room for the short title ("Nov 8 – 14").
  for (let width = CALENDAR_LEAST.width; width <= 1400; width += 7) {
    const chrome = chromeFor(width);
    expect(toolbarRoom(width, chrome.sidebarWidth) - CONTROLS_COMPACT - 10).toBeGreaterThanOrEqual(80);
  }
  // Not laid out yet: the full chrome.
  expect(chromeFor(0).rail).toBe(false);
});

test("a narrow window's title is the short one", () => {
  const week = weekDays("2026-11-11", 0);
  expect(viewTitle("week", "2026-11-11", week, prefs)).toBe("Nov 8 – 14, 2026");
  expect(shortViewTitle("week", "2026-11-11", week, prefs)).toBe("Nov 8 – 14");
  expect(shortViewTitle("month", "2026-11-11", [], prefs)).toBe("Nov 2026");
  expect(shortViewTitle("day", "2026-11-11", ["2026-11-11"], prefs)).toBe("Wed, Nov 11");
});

test("Find's answers hang under its field, inside the window", () => {
  expect(resultsPlace({ x: 120, y: 5, width: 260, height: 28 }, 1097)).toEqual({ top: 39, left: 120, width: RESULTS_WIDTH });
  // Near the right edge they move in, 12 from it.
  expect(resultsPlace({ x: 400, y: 5, width: 120, height: 28 }, 539)).toEqual({ top: 39, left: 539 - 12 - RESULTS_WIDTH, width: RESULTS_WIDTH });
  // Before the field is laid out: under the toolbar at the right.
  expect(resultsPlace(null, 1097)).toEqual({ top: 42, left: 1097 - 12 - RESULTS_WIDTH, width: RESULTS_WIDTH });
});

test("the event sheet's form scrolls within what a short window leaves", () => {
  // The small window (401 tall, toolbar 38): the sheet hangs at 46, keeps 16 from the foot, 42 of padding and edge, 40 of buttons.
  expect(sheetBodyRoom(401, 38, 40)).toBe(401 - 46 - 16 - 42 - 40);
  // Never less than a few rows.
  expect(sheetBodyRoom(200, 38, 40)).toBe(96);
});

test("a sheet keeps 16 from a narrow window's sides", () => {
  expect(sheetWidth(520, 1097)).toBe(520);
  expect(sheetWidth(520, 521)).toBe(489);
  expect(sheetWidth(520, 0)).toBe(520);
});

test("the popover stays inside a short window at its drawn height", () => {
  // The small window's content (38 down, 363 tall); the popover measured 163 tall, pressed on an event at 300.
  const at = popoverOrigin({ x: 120, y: 300, width: 400, height: 70 }, { x: 56, y: 38, width: 465, height: 363 }, 163);
  expect(at.y + 163).toBeLessThanOrEqual(38 + 363 - 8);
  expect(at.y).toBe(230);
});
