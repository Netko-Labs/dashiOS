/** Where the capsule sits (src/capsule/lib/place.ts, locate.ts): home, beside the Dock, a step up, the edge, and which screen. */

import { expect, test } from "bun:test";
import { locate } from "../src/capsule/lib/locate.ts";
import { CAPSULE, SEAT } from "../src/capsule/lib/measures.ts";
import { cardBottom, dockTop, placeOf } from "../src/capsule/lib/place.ts";
import type { DockPlace } from "../src/dock/index.ts";

const screen = { x: 0, y: 0, width: 1280, height: 800 };
const usable = { x: 0, y: 28, width: 1280, height: 701 };
const dock: DockPlace = { shown: true, style: "dock", panel: { x: 440, width: 400 }, output: undefined };
const centred = { x: 200, y: 100, width: 880, height: 500, focused: true };
const filling = { x: 0, y: 28, width: 1280, height: 701, focused: true };

test("home is the bottom centre, just above the Dock", () => {
  expect(dockTop(dock)).toBe(71);
  expect(placeOf({ dock, screen, usable, windows: [centred] })).toEqual({
    seat: "home",
    bottom: 80,
    at: { centre: true },
    maxWidth: CAPSULE.maxWidth,
    tail: CAPSULE.tail,
  });
  expect(placeOf({ dock, screen, usable, windows: [] }).seat).toBe("home");
});

test("a window that fills down to the Dock sends it into the Dock's row, beside the Dock", () => {
  const place = placeOf({ dock, screen, usable, windows: [filling] });
  expect(place).toMatchObject({ seat: "right", bottom: SEAT.row, at: { left: 852 }, maxWidth: 350, tail: 180 });
});

test("a window that floats above the capsule's place leaves it at home; one it would lie on moves it", () => {
  // The capsule is 80 to 111 from the bottom edge: 689 to 720 on this screen.
  expect(placeOf({ dock, screen, usable, windows: [{ ...centred, height: 592 }] }).seat).toBe("home");
  expect(placeOf({ dock, screen, usable, windows: [{ ...centred, height: 600 }] }).seat).toBe("right");
  // Off to the side of the middle: nothing under it.
  expect(placeOf({ dock, screen, usable, windows: [{ x: 900, y: 28, width: 380, height: 701, focused: true }] }).seat).toBe("home");
});

test("tiled windows, with their gaps: it sits on the side of the one that has the keyboard", () => {
  const left = { x: 8, y: 36, width: 748, height: 685, focused: true };
  const right = { x: 764, y: 36, width: 508, height: 685, focused: false };
  expect(placeOf({ dock, screen, usable, windows: [left, right] })).toMatchObject({ seat: "left", at: { right: 852 } });
  expect(
    placeOf({
      dock,
      screen,
      usable,
      windows: [
        { ...left, focused: false },
        { ...right, x: 520, width: 760, focused: true },
      ],
    }).seat,
  ).toBe("right");
});

test("with no room beside the Dock it goes one step up", () => {
  const wide: DockPlace = { ...dock, panel: { x: 100, width: 1080 } };
  expect(placeOf({ dock: wide, screen, usable, windows: [filling] })).toMatchObject({ seat: "up", bottom: 80 + SEAT.step, at: { centre: true } });
  expect(placeOf({ dock: { ...dock, style: "taskbar", panel: null }, screen, usable, windows: [filling] }).seat).toBe("up");
});

test("with the Dock hidden it sits against the edge, or a step up from it over a window", () => {
  const hidden: DockPlace = { ...dock, shown: false, panel: null };
  const whole = { x: 0, y: 28, width: 1280, height: 772 };
  expect(placeOf({ dock: hidden, screen, usable: whole, windows: [] })).toMatchObject({ seat: "edge", bottom: SEAT.edge });
  expect(placeOf({ dock: null, screen, usable: whole, windows: [{ ...whole, focused: true }] })).toMatchObject({ seat: "edge-up", bottom: SEAT.edgeUp });
});

test("a card stands on the Dock, a little over its top; against the edge with none", () => {
  expect(cardBottom(dock, true)).toBe(63);
  expect(cardBottom(dock, false)).toBe(SEAT.edge);
  expect(cardBottom(null, true)).toBe(SEAT.edge);
});

test("it goes on the display of the window that has the keyboard, else the pointer's, else the primary", () => {
  const outputs = [
    { name: "eDP-1", primary: true, enabled: true, frame: screen, usable },
    { name: "DP-2", primary: false, enabled: true, frame: { ...screen, x: 1280 }, usable: { ...usable, x: 1280, height: 772 } },
  ];
  const onSecond = { focused: true, state: "normal", frame: { x: 1400, y: 28, width: 900, height: 772 } };
  const found = locate(outputs, [onSecond, { focused: false, state: "normal", frame: centred }], { x: 10, y: 10 }, { ...dock, output: "eDP-1" });
  expect(found?.output).toBe("DP-2");
  // No Dock on that display, and a window down to its edge.
  expect(found?.input.dock).toBeNull();
  expect(found && placeOf(found.input).seat).toBe("edge-up");
  expect(locate(outputs, [{ ...onSecond, focused: false }], { x: 1300, y: 10 }, dock)?.output).toBe("DP-2");
  expect(locate(outputs, [{ ...onSecond, state: "minimized" }], null, dock)?.output).toBe("eDP-1");
  expect(locate([], [], null, dock)).toBeNull();
});
