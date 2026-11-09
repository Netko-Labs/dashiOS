import { describe, expect, test } from "bun:test";
import { buttonLook } from "../src/button-look.ts";
import { isHeld } from "../src/control-state.tsx";
import { litAfter, MENU, menuFits, menuHeight, placeMenu, rowTop } from "../src/menu-place.ts";
import { popUpOrigin } from "../src/popup-button.tsx";
import { clampFraction, SPOKES, SWEEP_TICKS, spinnerMarkup, spokeOpacities, sweepOffset } from "../src/progress-math.ts";
import { isSeparator, MENU_SEPARATOR, type MenuEntry, tidyEntries } from "../src/sheet.tsx";
import { fractionAt, fractionOf, keyValues, knobLeft, nearestIndex, UNIT_RANGE, valueAt } from "../src/slider-math.ts";
import { contrastRatio } from "../src/theme/contrast.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";

describe("the slider's arithmetic", () => {
  const range = { min: -1, max: 1, step: 0.05 };
  test("a value's place on the bar, inside 0 to 1", () => {
    expect(fractionOf(0, range)).toBe(0.5);
    expect(fractionOf(5, range)).toBe(1);
    expect(fractionOf(-5, range)).toBe(0);
    expect(fractionOf(3, { min: 2, max: 2, step: 1 })).toBe(0);
  });
  test("a place on the bar snaps to the step, with no float dust", () => {
    expect(valueAt(0.6534, range)).toBe(0.3);
    expect(valueAt(2, range)).toBe(1);
    expect(valueAt(0.5, { min: 100, max: 1000, step: 25 })).toBe(550);
    // A level with no step is left as it is.
    expect(valueAt(0.4321, UNIT_RANGE)).toBe(0.4321);
  });
  test("the pointer holds the knob's center", () => {
    const bar = { x: 100, width: 218 };
    expect(fractionAt(109, bar, 18)).toBe(0);
    expect(fractionAt(209, bar, 18)).toBe(0.5);
    expect(fractionAt(400, bar, 18)).toBe(1);
    expect(fractionAt(50, { x: 0, width: 10 }, 18)).toBe(0);
    expect(knobLeft(0.5, 218, 18)).toBe(100);
    expect(knobLeft(2, 218, 18)).toBe(200);
  });
  test("the arrows step every step when there are few, else about 5%, end to end", () => {
    expect(keyValues({ min: 0, max: 100, step: 25 })).toEqual([0, 25, 50, 75, 100]);
    const fine = keyValues({ min: 0, max: 100, step: 1 });
    expect(fine).toHaveLength(21);
    expect(fine.slice(0, 3)).toEqual([0, 5, 10]);
    expect(fine.at(-1)).toBe(100);
    const free = keyValues(UNIT_RANGE);
    expect(free).toHaveLength(21);
    expect(free[1]).toBeCloseTo(0.05);
    // A span the stride doesn't divide still ends at the maximum.
    expect(keyValues({ min: 1700, max: 6500, step: 100 })).toEqual([...Array.from({ length: 16 }, (_, i) => 1700 + 300 * i), 6500]);
    expect(keyValues({ min: 3, max: 3, step: 1 })).toEqual([3]);
  });
  test("the arrows step on from the notch nearest the value", () => {
    const values = [0, 25, 50, 75, 100];
    expect(nearestIndex(values, 0)).toBe(0);
    expect(nearestIndex(values, 60)).toBe(2);
    expect(nearestIndex(values, 64)).toBe(3);
    expect(nearestIndex(values, 400)).toBe(4);
  });
});

describe("a menu's keys", () => {
  // Items, a separator, a disabled item, an item.
  const usable = [true, true, false, false, true];
  test("↓ and ↑ light the next row that can be picked, stopping at the ends", () => {
    expect(litAfter(usable, null, 1)).toBe(0);
    expect(litAfter(usable, null, -1)).toBe(4);
    expect(litAfter(usable, 1, 1)).toBe(4);
    expect(litAfter(usable, 4, -1)).toBe(1);
    expect(litAfter(usable, 4, 1)).toBe(4);
    expect(litAfter(usable, 0, -1)).toBe(0);
    expect(litAfter([false, false], null, 1)).toBeNull();
  });
});

describe("the progress control", () => {
  test("a fraction is kept inside 0 to 1, and nonsense is none", () => {
    expect(clampFraction(0.42)).toBe(0.42);
    expect(clampFraction(-1)).toBe(0);
    expect(clampFraction(3)).toBe(1);
    expect(clampFraction(Number.NaN)).toBe(0);
  });
  test("the indeterminate segment goes across and back once a sweep", () => {
    expect(sweepOffset(0, 1000)).toBe(0);
    expect(sweepOffset(SWEEP_TICKS / 2, 1000)).toBe(700);
    expect(sweepOffset(SWEEP_TICKS / 4, 1000)).toBe(350);
    expect(sweepOffset((3 * SWEEP_TICKS) / 4, 1000)).toBe(350);
    expect(sweepOffset(SWEEP_TICKS, 1000)).toBe(0);
  });
  test("the lit spoke moves on each tick, the ones behind it fading", () => {
    const now = spokeOpacities(2);
    expect(now).toHaveLength(SPOKES);
    expect(now[2]).toBe(1);
    expect(now[1]).toBeLessThan(1);
    expect(now[3]).toBe(0.25);
    expect(spokeOpacities(2 + SPOKES)).toEqual(now);
    expect(spinnerMarkup(0)).toContain('stroke-opacity="1"');
    expect(spinnerMarkup(0).match(/<path/g)).toHaveLength(SPOKES);
  });
});

describe("menus", () => {
  test("separators collapse: none first, last, or twice", () => {
    const item = (label: string): MenuEntry => ({ label, onPress: () => {} });
    const tidy = tidyEntries([MENU_SEPARATOR, item("Open"), MENU_SEPARATOR, MENU_SEPARATOR, item("Copy"), MENU_SEPARATOR]);
    expect(tidy.map((entry) => (isSeparator(entry) ? "—" : entry.label))).toEqual(["Open", "—", "Copy"]);
  });
  test("a menu's height comes from its rows", () => {
    expect(menuHeight(["item", "item", "separator", "item"])).toBe(3 * MENU.row + MENU.separator + 2 * (MENU.padding + MENU.edge));
    expect(rowTop(["item", "separator", "item"], 2)).toBe(MENU.padding + MENU.edge + MENU.row + MENU.separator);
  });
  test("a menu opens at the point, flips when it would run off, and is clamped when it fits on neither side", () => {
    const room = { width: 800, height: 600 };
    const size = { width: 200, height: 300 };
    expect(placeMenu({ x: 100, y: 100 }, size, room)).toEqual({ x: 100, y: 100 });
    // Near the right and the bottom: to the left of and above the pointer.
    expect(placeMenu({ x: 700, y: 500 }, size, room)).toEqual({ x: 500, y: 200 });
    // Too tall for either side of the point: slid up to fit.
    expect(placeMenu({ x: 100, y: 250 }, { width: 200, height: 400 }, room)).toEqual({ x: 100, y: 194 });
    // Without flipping (a pop-up over its button) it only slides in.
    expect(placeMenu({ x: 700, y: -20 }, size, room, false)).toEqual({ x: 594, y: 6 });
    // Before the window's size is known, it stays where it was asked.
    expect(placeMenu({ x: 700, y: 500 }, size, { width: 0, height: 0 })).toEqual({ x: 700, y: 500 });
  });
  test("a menu taller than the window is drawn as tall as the window allows, its rows scrolling", () => {
    const twenty = menuHeight(Array.from({ length: 20 }, () => "item" as const));
    expect(menuFits(twenty, 0)).toBe(twenty);
    expect(menuFits(twenty, 1000)).toBe(twenty);
    expect(menuFits(twenty, 300)).toBe(300 - 2 * MENU.margin);
    // However short the window, one row still shows.
    expect(menuFits(twenty, 20)).toBe(MENU.row + 2 * (MENU.padding + MENU.edge));
    // Placed at that height, it fits the window.
    const at = placeMenu({ x: 10, y: 200 }, { width: 160, height: menuFits(twenty, 300) }, { width: 800, height: 300 });
    expect(at.y).toBe(MENU.margin);
  });
  test("a pop-up's menu puts the chosen row over the button", () => {
    const button = { x: 300, y: 100, width: 120, height: 28 };
    const rows = ["item", "item", "separator", "item"] as const;
    const at = popUpOrigin(button, rows, 3);
    expect(at.y + rowTop(rows, 3) + MENU.row / 2).toBe(button.y + button.height / 2);
    expect(at.x).toBeLessThan(button.x);
  });
});

describe("states", () => {
  test("a press holds from down until up", () => {
    expect(isHeld("down")).toBe(true);
    expect(isHeld("move")).toBe(true);
    expect(isHeld("up")).toBe(false);
  });
  for (const [mode, colors] of [
    ["light", lightColors],
    ["dark", darkColors],
  ] as const) {
    test(`${mode}: buttons deepen under the pointer and more when held, white staying AA`, () => {
      for (const kind of ["primary", "danger"] as const) {
        const rest = buttonLook(colors, kind);
        const held = buttonLook(colors, kind, { pressed: true });
        expect(held.fill).not.toBe(rest.fill);
        for (const fill of [rest.fill, rest.hover, held.fill]) expect(contrastRatio("#ffffff", fill)).toBeGreaterThanOrEqual(4.5);
      }
      const secondary = buttonLook(colors, "secondary");
      expect(buttonLook(colors, "secondary", { pressed: true }).fill).toBe(colors.pressed);
      expect(secondary.edge).toBe(colors.controlEdge);
      expect(buttonLook(colors, "secondary", { isDefault: true })).toMatchObject({ edge: colors.selection, edgeWidth: 2 });
    });
  }
});
