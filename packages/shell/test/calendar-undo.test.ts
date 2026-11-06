import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changeName } from "../apps/calendar/history.ts";
import { CalendarModel } from "../apps/calendar/model.ts";
import { CalendarStore } from "../apps/calendar/store.ts";
import type { CalEvent } from "../apps/calendar/types.ts";

let root = "";
let model: CalendarModel;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-calendar-undo-"));
  model = new CalendarModel(new CalendarStore(root), () => new Date("2026-11-05T10:00:00"));
  model.createCalendar("Work");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const events = (id: string): CalEvent[] => model.calendar(id)?.events ?? [];
const lunch = { title: "Lunch", allDay: false, start: "2026-11-06T12:00", end: "2026-11-06T13:00" };

test("Undo Delete Event puts it back as it was; Redo deletes it again", async () => {
  expect(model.saveEvent("Home", null, lunch)).toBe(true);
  const [made] = events("Home");
  if (!made) throw new Error("no event");
  expect(model.deleteEvent("Home", made.uid)).toBe(true);
  expect(model.undo.state.undoName).toBe("Delete Event");
  await model.undoStep("undo");
  expect(events("Home")).toEqual([made]);
  await model.undoStep("redo");
  expect(events("Home")).toEqual([]);
});

test("moving an event to another time or calendar is a Move Event, undone to where it was", async () => {
  model.saveEvent("Home", null, lunch);
  const [made] = events("Home");
  if (!made) throw new Error("no event");
  model.saveEvent("Home", made.uid, { ...lunch, start: "2026-11-07T12:00", end: "2026-11-07T13:00" }, "Work");
  expect(model.undo.state.undoName).toBe("Move Event");
  expect(events("Home")).toEqual([]);
  await model.undoStep("undo");
  expect(events("Home")).toEqual([made]);
  expect(events("Work")).toEqual([]);
  await model.undoStep("redo");
  expect(events("Work").map((event) => event.start)).toEqual(["2026-11-07T12:00"]);
  // And the new event itself can go.
  await model.undoStep("undo");
  await model.undoStep("undo");
  expect(model.undo.state.canUndo).toBe(false);
  expect(events("Home")).toEqual([]);
});

test("a step that can't be done says why and leaves the stack", async () => {
  model.saveEvent("Home", null, lunch);
  model.removeCalendar("Home");
  await model.undoStep("undo");
  expect(model.getSnapshot().error).not.toBeNull();
});

test("what a change is called", () => {
  const event = { uid: "1", title: "Lunch", start: "2026-11-06T12:00", end: "2026-11-06T13:00" } as CalEvent;
  const at = (calendarId: string, change: Partial<CalEvent> = {}) => ({ calendarId, event: { ...event, ...change } });
  expect(changeName({ before: null, after: at("Home") })).toBe("New Event");
  expect(changeName({ before: at("Home"), after: null })).toBe("Delete Event");
  expect(changeName({ before: at("Home"), after: at("Work") })).toBe("Move Event");
  expect(changeName({ before: at("Home"), after: at("Home", { start: "2026-11-06T14:00" }) })).toBe("Move Event");
  expect(changeName({ before: at("Home"), after: at("Home", { title: "Dinner" }) })).toBe("Edit Event");
});
