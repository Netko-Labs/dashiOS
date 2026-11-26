/**
 * Today's Up next names its events (LK-1, lock-v3 C: "the next three events"; decisions.md D820): the
 * installed pass saw "EVENT" and a bare line where the title goes. The person can still hide them for
 * their Calendar widget (`showPrivateWhenLocked: false`).
 */

import { afterEach, beforeEach, expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { setCalendarBridge } from "../src/calendar/bridge.ts";
import { LockScreen } from "../src/lock/lib/screen.tsx";
import type { Occurrence } from "../src/shared/calendar/index.ts";
import { setWidgetHub, todayEventsShown, WidgetHub } from "../src/widgets/index.ts";
import { settle } from "./support/time.ts";

/** A local time `hours` from now, as the calendar writes it ("2026-11-27T10:00"). */
function inHours(hours: number): string {
  const at = new Date(Date.now() + hours * 3_600_000);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}T${two(at.getHours())}:${two(at.getMinutes())}`;
}

const review: Occurrence = {
  event: {
    uid: "review",
    title: "Design review: glass",
    allDay: false,
    start: inHours(2),
    end: inHours(3),
    location: "Room 4",
    notes: "",
    zone: null,
    alert: null,
    repeat: null,
    rawRule: null,
    exdates: [],
    overrides: [],
  } as unknown as Occurrence["event"],
  calendarId: "Work",
  start: inHours(2),
  end: inHours(3),
  recurrenceId: null,
};

let root: NativeRoot;
let trees: string[] = [];
let listeners: ((event: NativeEvent) => void)[] = [];

beforeEach(async () => {
  trees = [];
  listeners = [];
  setCalendarBridge({
    busyDays: () => new Set(),
    occurrences: () => [review],
    subscribe: () => () => {},
    getVersion: () => 1,
    openDay() {},
  });
  setWidgetHub(new WidgetHub({ notify() {}, live: false, openArea() {} }));
  const transport: NativeTransport = {
    send: (tree) => trees.push(tree),
    onEvent: (listener) => listeners.push(listener),
    onClose() {},
    simulate() {},
    close() {},
  };
  root = render(<LockScreen name="Alex Kim" onSubmit={async () => "wrong"} waitMs={() => 0} />, transport);
  await settle();
  const screen = root.nodeId("login-screen");
  if (!screen) throw new Error("no lock screen");
  for (const listener of listeners) listener({ type: "resize", nodeId: screen, bounds: { x: 0, y: 0, width: 1646, height: 1029 } });
  await settle();
});
afterEach(() => {
  root.unmount();
  setWidgetHub(null);
  setCalendarBridge(null);
});

test("Up next on the lock says the event's title, not a blank", () => {
  expect(root.nodeId("lock-widget:calendar")).toBeDefined();
  const tree = trees.at(-1) ?? "";
  expect(tree).toContain("Design review: glass");
  expect(tree).not.toContain('"EVENT"');
});

test("a person who hid their calendar's words on the lock keeps them hidden", () => {
  expect(todayEventsShown([])).toBe(true);
  expect(todayEventsShown([{ id: "c", kind: "calendar", size: "wide" }])).toBe(true);
  expect(todayEventsShown([{ id: "c", kind: "calendar", size: "wide", showPrivateWhenLocked: false }])).toBe(false);
});
