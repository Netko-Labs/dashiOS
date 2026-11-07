import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { HOUR_HEIGHT } from "../apps/calendar/layout.ts";
import { CalendarModel } from "../apps/calendar/model.ts";
import { CalendarStore } from "../apps/calendar/store.ts";
import type { CalEvent } from "../apps/calendar/types.ts";
import { CalendarWindow } from "../apps/calendar/view.tsx";

// The grid as the editor, on a stand-in for the Metal host: draw an event and name it in place,
// drag it to another day and time, stretch it, cancel a drag with Esc, and take it all back with Undo.

let dir = "";
let model: CalendarModel;
let root: NativeRoot;
let listeners: ((event: NativeEvent) => void)[] = [];
const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dashi-calendar-grid-"));
  // Thursday, November 5, 2026, in the week view.
  model = new CalendarModel(new CalendarStore(dir), () => new Date("2026-11-05T08:00:00"), { view: "week", day: "2026-11-05" });
  listeners = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  root = render(<CalendarWindow model={model} chooser={{ choose: async () => null }} scroll={() => {}} />, transport);
  await settle();
  // The columns are 100 wide (the first column says so; the week starts on Saturday, Sunday, or Monday by region).
  for (const day of ["2026-10-31", "2026-11-01", "2026-11-02"]) {
    const nodeId = root.nodeId(`column:${day}`);
    if (nodeId) await emit({ type: "resize", nodeId, bounds: { x: 100, y: 100, width: 100, height: HOUR_HEIGHT * 24 } });
  }
});
afterEach(() => {
  root.unmount();
  rmSync(dir, { recursive: true, force: true });
});

const id = (testID: string): string => {
  const found = root.nodeId(testID);
  if (!found) throw new Error(`no node ${testID}`);
  return found;
};
const emit = async (event: NativeEvent): Promise<void> => {
  for (const listener of listeners) listener(event);
  await settle();
};
/** A press at `y` on a view whose top is at 100 in the window, moved by dx, dy, and let go. */
async function drag(testID: string, y: number, dx: number, dy: number, options: { escape?: boolean } = {}): Promise<void> {
  const nodeId = id(testID);
  const bounds = { x: 200, y: 100, width: 100, height: HOUR_HEIGHT * 24 };
  await emit({ type: "pointer", nodeId, phase: "down", x: 220, y: 100 + y, bounds });
  await emit({ type: "pointer", nodeId, phase: "move", x: 220 + dx / 2, y: 100 + y + dy / 2, bounds });
  await emit({ type: "pointer", nodeId, phase: "move", x: 220 + dx, y: 100 + y + dy, bounds });
  if (options.escape) await emit({ type: "windowkey", nodeId: id("keys"), key: "escape", ctrl: false, alt: false, shift: false, meta: false, repeat: false });
  await emit({ type: "pointer", nodeId, phase: "up", x: 220 + dx, y: 100 + y + dy, bounds });
}
const events = (): CalEvent[] => model.calendar("Home")?.events ?? [];

test("drawing on empty time makes an event, named in place", async () => {
  // From 10:00 down an hour and a half.
  await drag("column:2026-11-04", HOUR_HEIGHT * 10, 0, HOUR_HEIGHT * 1.5);
  expect(root.nodeId("pending-title")).toBeTruthy();
  await emit({ type: "change", nodeId: id("pending-title"), value: "Lunch with Mei" });
  await emit({ type: "submit", nodeId: id("pending-title"), value: "Lunch with Mei" });
  expect(events().map((event) => [event.title, event.start, event.end])).toEqual([["Lunch with Mei", "2026-11-04T10:00", "2026-11-04T11:45"]]);
  expect(model.undo.state.undoName).toBe("New Event");
});

test("a block dragged across days and down moves, its foot stretches it, and Undo takes each back", async () => {
  model.addEvent("Home", { title: "Review", allDay: false, start: "2026-11-03T09:00", end: "2026-11-03T10:00" });
  await settle();
  const block = "event:Home:" + events()[0]?.uid + ":2026-11-03T09:00";
  // One column right and 45 minutes down: Wednesday at 9:45.
  await drag(block, HOUR_HEIGHT * 9, 100, HOUR_HEIGHT * 0.75);
  expect(events()[0]?.start).toBe("2026-11-04T09:45");
  expect(model.undo.state.undoName).toBe("Move Event");
  const moved = events()[0]?.uid;
  await drag(`resize:Home:${moved}:2026-11-04T09:45`, HOUR_HEIGHT * 10.7, 0, HOUR_HEIGHT * 0.5);
  expect([events()[0]?.start, events()[0]?.end]).toEqual(["2026-11-04T09:45", "2026-11-04T11:15"]);
  expect(model.undo.state.undoName).toBe("Resize Event");
  await model.undoStep("undo");
  await model.undoStep("undo");
  expect([events()[0]?.start, events()[0]?.end]).toEqual(["2026-11-03T09:00", "2026-11-03T10:00"]);
});

test("Esc during a drag leaves the event where it was", async () => {
  model.addEvent("Home", { title: "Review", allDay: false, start: "2026-11-03T09:00", end: "2026-11-03T10:00" });
  await settle();
  await drag(`event:Home:${events()[0]?.uid}:2026-11-03T09:00`, HOUR_HEIGHT * 9, 100, HOUR_HEIGHT * 2, { escape: true });
  expect(events()[0]?.start).toBe("2026-11-03T09:00");
  expect(model.undo.state.canUndo).toBe(true);
  expect(model.undo.state.undoName).toBe("New Event");
});

test("dragging one time of a repeat asks which times it is for; This event moves it alone", async () => {
  model.addEvent("Home", {
    title: "Standup",
    allDay: false,
    start: "2026-11-02T09:00",
    end: "2026-11-02T09:15",
    repeat: { freq: "daily", interval: 1 },
  });
  await settle();
  const uid = events()[0]?.uid;
  await drag(`event:Home:${uid}:2026-11-05T09:00`, HOUR_HEIGHT * 9, 0, HOUR_HEIGHT);
  expect(root.nodeId("scope")).toBeTruthy();
  await emit({ type: "press", nodeId: id("scope:this") });
  const [standup] = events();
  expect(standup?.start).toBe("2026-11-02T09:00");
  expect(standup?.overrides.map((each) => [each.recurrenceId, each.start])).toEqual([["2026-11-05T09:00", "2026-11-05T10:00"]]);
});
