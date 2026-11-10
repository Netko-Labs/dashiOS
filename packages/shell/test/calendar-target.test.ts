import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarModel } from "../apps/calendar/model.ts";
import { choosableCalendars, newEventTarget } from "../apps/calendar/target.ts";
import { readSidecar } from "../src/shared/calendar/sidecar.ts";
import { CalendarStore, PALETTE, paletteColor } from "../src/shared/calendar/store.ts";

const home = { id: "Home", name: "Home" };
const work = { id: "Work", name: "Work" };
const trips = { id: "Trips", name: "Trips" };

test("a new event goes to the chosen calendar when it shows, else Home, else the first that shows", () => {
  expect(newEventTarget([work, home, trips], [], "Trips")).toEqual({ calendarId: "Trips", reveal: false });
  expect(newEventTarget([work, home, trips], [], null)).toEqual({ calendarId: "Home", reveal: false });
  expect(newEventTarget([work, trips], [], null)).toEqual({ calendarId: "Work", reveal: false });
  expect(newEventTarget([], [], null)).toBeNull();
});

test("a new event never goes into a hidden calendar", () => {
  // The chosen one is hidden: Home, which shows, takes it.
  expect(newEventTarget([work, home, trips], ["Trips"], "Trips")).toEqual({ calendarId: "Home", reveal: false });
  // Home is hidden too: the first that shows.
  expect(newEventTarget([work, home, trips], ["Trips", "Home"], "Trips")).toEqual({ calendarId: "Work", reveal: false });
});

test("with every calendar hidden, the one it would go to is named, to be shown again first", () => {
  expect(newEventTarget([home], ["Home"], null)).toEqual({ calendarId: "Home", reveal: true });
  expect(newEventTarget([work, home, trips], ["Work", "Home", "Trips"], "Trips")).toEqual({ calendarId: "Trips", reveal: true });
  expect(newEventTarget([work, trips], ["Work", "Trips"], "Gone")).toEqual({ calendarId: "Work", reveal: true });
});

test("the event sheet offers the calendars that show, and the event's own", () => {
  expect(choosableCalendars([work, home, trips], ["Trips"], "Home").map((c) => c.id)).toEqual(["Work", "Home"]);
  expect(choosableCalendars([work, home, trips], ["Trips"], "Trips").map((c) => c.id)).toEqual(["Work", "Home", "Trips"]);
});

test("revealing a hidden calendar shows it, says so, and writes the sidecar", () => {
  const root = mkdtempSync(join(tmpdir(), "dashi-calendar-target-"));
  const model = new CalendarModel(new CalendarStore(root), () => new Date("2026-11-05T10:00:00"));
  model.toggle("Home");
  expect(model.isVisible("Home")).toBe(false);
  const target = newEventTarget(model.getSnapshot().calendars, model.getSnapshot().hidden, null);
  expect(target).toEqual({ calendarId: "Home", reveal: true });
  expect(model.reveal("Home")).toBe(true);
  expect(model.isVisible("Home")).toBe(true);
  expect(readSidecar(root).hidden).toEqual([]);
  expect(model.getSnapshot().notice).toContain("“Home” is shown again");
  // A calendar that shows already is left alone, with nothing to say.
  model.dismissMessages();
  expect(model.reveal("Home")).toBe(true);
  expect(model.getSnapshot().notice).toBeNull();
});

test("new calendars take Dashi's tints in turn, never red", () => {
  expect(paletteColor(0)).toBe(PALETTE[0] as string);
  expect(paletteColor(PALETTE.length + 1)).toBe(PALETTE[1] as string);
  for (const color of PALETTE) expect(["#ff3b30", "#d0596f", "#d4483b"]).not.toContain(color);
  const root = mkdtempSync(join(tmpdir(), "dashi-calendar-palette-"));
  const store = new CalendarStore(root);
  expect(store.ensureDefault().calendars[0]?.color).toBe(PALETTE[0] as string);
  expect(store.create("Work").color).toBe(PALETTE[1] as string);
});
