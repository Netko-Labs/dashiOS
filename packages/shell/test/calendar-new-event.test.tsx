import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { HOUR_HEIGHT, revealOffset } from "../apps/calendar/lib/layout.ts";
import { CalendarModel } from "../apps/calendar/lib/model.ts";
import { CalendarWindow } from "../apps/calendar/lib/views/view.tsx";
import { CalendarStore } from "../src/shared/calendar/store.ts";
import { settle } from "./support/time.ts";

// The + button and naming in place, on a stand-in for the Metal host.

let dir = "";
let model: CalendarModel;
let root: NativeRoot;
let listeners: ((event: NativeEvent) => void)[] = [];
let scrolls: [string, number][] = [];
const id = (testID: string): string => root.nodeId(testID) ?? "";
const emit = async (event: NativeEvent): Promise<void> => {
  for (const listener of listeners) listener(event);
  await settle();
};
const key = (name: string): NativeEvent => ({
  type: "windowkey",
  nodeId: id("keys"),
  key: name,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dashi-calendar-new-"));
  listeners = [];
  scrolls = [];
});
afterEach(() => {
  root.unmount();
  rmSync(dir, { recursive: true, force: true });
});

async function open(view: "week" | "month"): Promise<void> {
  // Thursday, November 5, 2026, at 8:00 in the morning.
  model = new CalendarModel(new CalendarStore(dir), () => new Date("2026-11-05T08:00:00"), { view, day: "2026-11-05" });
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  root = render(<CalendarWindow model={model} chooser={{ choose: async () => null }} scroll={(testID, dy) => scrolls.push([testID, dy])} />, transport);
  await settle(120);
}

test("the + button's new event is scrolled into sight, wherever the hours were", async () => {
  await open("week");
  // Wednesday picked: a new event there starts at 9:00.
  model.select("2026-11-04");
  await settle();
  scrolls = [];
  await emit({ type: "press", nodeId: id("new-event") });
  expect(root.nodeId("pending-title")).toBeTruthy();
  // The hours go to the top, then to an hour above it.
  expect(scrolls).toEqual([
    ["hours", -100_000],
    ["hours", revealOffset(9 * 60)],
  ]);
  expect(revealOffset(9 * 60)).toBe(HOUR_HEIGHT * 8);
});

test("after naming an event in place, the keys are the grid's again", async () => {
  await open("month");
  await emit({ type: "press", nodeId: id("day:2026-11-23") });
  await emit({ type: "press", nodeId: id("day:2026-11-23") });
  const whileNaming = id("keys");
  await emit({ type: "change", nodeId: id("pending-title"), value: "Holiday" });
  await emit({ type: "submit", nodeId: id("pending-title"), value: "Holiday" });
  expect(root.nodeId("pending-title")).toBeUndefined();
  // A new key sink: Metal gives the window the keyboard back when one appears.
  expect(id("keys")).not.toBe(whileNaming);
  await emit(key("right"));
  expect(model.getSnapshot().selected).toBe("2026-11-24");
});
