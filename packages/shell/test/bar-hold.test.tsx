import { expect, test } from "bun:test";
import { View } from "@mirinjs/metal";
import { BarHold, holdingBar, SETTLE_MS } from "../src/menubar/bar-hold.ts";
import type { OpenOverlay } from "../src/overlay.tsx";

// A shell sheet that takes the keyboard (Settings' Change Password) holds the
// menu bar's app name and menus until a moment after it closes.

function manual() {
  const pending: Array<{ run: () => void; ms: number }> = [];
  const hold = new BarHold((run, ms) => pending.push({ run, ms }));
  const flush = () => {
    for (const each of pending.splice(0)) each.run();
  };
  return { hold, pending, flush };
}

test("held from the first sheet until a moment after the last one closes", () => {
  const { hold, pending, flush } = manual();
  const heard: boolean[] = [];
  hold.subscribe(() => heard.push(hold.getSnapshot()));
  expect(hold.getSnapshot()).toBe(false);
  const first = hold.begin();
  const second = hold.begin();
  expect(hold.getSnapshot()).toBe(true);
  first();
  first();
  flush();
  expect(hold.getSnapshot()).toBe(true);
  second();
  // The window gets the keyboard back before the bar follows focus again.
  expect(hold.getSnapshot()).toBe(true);
  expect(pending.map((each) => each.ms)).toEqual([SETTLE_MS]);
  flush();
  expect(hold.getSnapshot()).toBe(false);
  expect(heard).toEqual([true, false]);
});

test("holdingBar holds while the surface is up, however it closes", () => {
  const { hold, flush } = manual();
  const closers: Array<() => void> = [];
  const open: OpenOverlay = (_options, _element, onClosed) => {
    closers.push(() => onClosed?.());
    return { close: () => onClosed?.() };
  };
  const held = holdingBar(open, hold);
  let closed = 0;

  // Closed by its owner.
  const sheet = held({ title: "Change Password" }, <View />, () => closed++);
  expect(hold.getSnapshot()).toBe(true);
  sheet.close();
  flush();
  expect(hold.getSnapshot()).toBe(false);
  expect(closed).toBe(1);

  // Its host went by itself.
  held({ title: "Wi-Fi" }, <View />);
  expect(hold.getSnapshot()).toBe(true);
  closers.at(-1)?.();
  flush();
  expect(hold.getSnapshot()).toBe(false);
});
