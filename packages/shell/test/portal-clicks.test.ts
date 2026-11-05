import { expect, test } from "bun:test";
import { ClickCounter, DOUBLE_CLICK_DISTANCE, DOUBLE_CLICK_MS, isDoubleClick, type Press } from "../apps/portal/file-chooser/clicks.ts";
import { MAX_COPIES, parseCopies } from "../apps/portal/print/settings.ts";
import { enterButton } from "../apps/portal/ui/frame.tsx";

const press = (patch: Partial<Press> = {}): Press => ({ target: "/h/a.pdf", x: 100, y: 40, time: 1000, ...patch });

test("a second press is a double-click only on the same row, within the interval and the distance", () => {
  expect(isDoubleClick(null, press())).toBe(false);
  expect(isDoubleClick(press(), press({ time: 1000 + DOUBLE_CLICK_MS }))).toBe(true);
  expect(isDoubleClick(press(), press({ time: 1001 + DOUBLE_CLICK_MS }))).toBe(false);
  expect(isDoubleClick(press(), press({ time: 1200, target: "/h/b.pdf" }))).toBe(false);
  expect(isDoubleClick(press(), press({ time: 1200, x: 100 + DOUBLE_CLICK_DISTANCE, y: 40 - DOUBLE_CLICK_DISTANCE }))).toBe(true);
  expect(isDoubleClick(press(), press({ time: 1200, x: 101 + DOUBLE_CLICK_DISTANCE }))).toBe(false);
  expect(isDoubleClick(press(), press({ time: 1200, y: 41 + DOUBLE_CLICK_DISTANCE }))).toBe(false);
  // A clock that went backwards is not a double-click.
  expect(isDoubleClick(press(), press({ time: 900 }))).toBe(false);
});

test("the counter: slow clicks only select, a quick pair opens once, a third press starts over", () => {
  const clicks = new ClickCounter();
  expect(clicks.press(press({ time: 0 }))).toBe(false);
  // Seconds later on the same, already selected row: still only a click.
  expect(clicks.press(press({ time: 3000 }))).toBe(false);
  expect(clicks.press(press({ time: 3250 }))).toBe(true);
  expect(clicks.press(press({ time: 3400 }))).toBe(false);
  expect(clicks.press(press({ time: 3500 }))).toBe(true);
  // Moving to another folder forgets the last press.
  clicks.press(press({ time: 5000 }));
  clicks.reset();
  expect(clicks.press(press({ time: 5100 }))).toBe(false);
  // Custom limits, for a slower double-click setting.
  const slow = new ClickCounter({ intervalMs: 800, distance: 2 });
  slow.press(press({ time: 0 }));
  expect(slow.press(press({ time: 700, x: 102 }))).toBe(true);
});

test("Copies keeps what is typed and reads it only as a count from 1 to 999", () => {
  expect(parseCopies("")).toBeNull();
  expect(parseCopies("0")).toBeNull();
  expect(parseCopies("2")).toBe(2);
  expect(parseCopies(" 12 ")).toBe(12);
  expect(parseCopies("05")).toBe(5);
  expect(parseCopies(String(MAX_COPIES))).toBe(MAX_COPIES);
  expect(parseCopies(String(MAX_COPIES + 1))).toBeNull();
  expect(parseCopies("2.5")).toBeNull();
  expect(parseCopies("-1")).toBeNull();
});

test("Enter presses the default button, but never one that grants something", () => {
  const cancel = { label: "Cancel", testID: "c", onPress: () => {} };
  const print = { label: "Print", testID: "p", onPress: () => {}, primary: true };
  expect(enterButton([cancel, print])?.label).toBe("Print");
  expect(enterButton([cancel, { ...print, disabled: true }])).toBeUndefined();
  expect(enterButton([cancel, { label: "Allow", testID: "a", onPress: () => {}, primary: true, grants: true }])).toBeUndefined();
});
