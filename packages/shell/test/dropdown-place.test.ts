import { describe, expect, test } from "bun:test";
import { MENU } from "@dashi/ui";
import { DROPDOWN, placeDropdown } from "../src/menus/place.ts";

// 0.6 menus: the menu bar's dropdown was drawn at its title with nothing keeping it on the screen; near
// the right edge of a narrow screen it ran off, and a menu taller than the screen ran past the foot.

const screen = { width: 1280, height: 772 };
const size = { width: 240, height: 300 };

describe("placeDropdown", () => {
  test("a title's menu opens at the title, just under the bar", () => {
    expect(placeDropdown({ kind: "start", x: 120 }, size, screen)).toEqual({ left: 120, top: DROPDOWN.top });
  });

  test("near the right edge it slides left, 6 in from the side", () => {
    const at = placeDropdown({ kind: "start", x: 1200 }, size, screen);
    expect(at.left + size.width).toBe(screen.width - MENU.margin);
  });

  test("a status item's menu ends at the item, and never past the left side", () => {
    expect(placeDropdown({ kind: "end", x: 1000 }, size, screen).left).toBe(1000 - size.width);
    expect(placeDropdown({ kind: "end", x: 100 }, size, screen).left).toBe(MENU.margin);
  });

  test("the Dock's menu centers on its icon, inside the screen", () => {
    expect(placeDropdown({ kind: "above", x: 640, bottom: 80 }, size, screen)).toEqual({ left: 520, bottom: 80 });
    expect(placeDropdown({ kind: "above", x: 1270, bottom: 80 }, size, screen).left).toBe(screen.width - MENU.margin - size.width);
    expect(placeDropdown({ kind: "above", x: 4, bottom: 80 }, size, screen).left).toBe(MENU.margin);
  });

  test("a menu taller than its room is capped there, and scrolls", () => {
    const tall = { width: 240, height: 900 };
    expect(placeDropdown({ kind: "start", x: 0 }, tall, screen).maxHeight).toBe(screen.height - DROPDOWN.top - MENU.margin);
    expect(placeDropdown({ kind: "above", x: 640, bottom: 80 }, tall, screen).maxHeight).toBe(screen.height - 80 - MENU.margin);
    expect(placeDropdown({ kind: "start", x: 0 }, size, screen).maxHeight).toBeUndefined();
  });

  test("before the screen is known it goes where it was asked", () => {
    expect(placeDropdown({ kind: "start", x: 2000 }, { width: 240, height: 2000 }, { width: 0, height: 0 })).toEqual({ left: 2000, top: DROPDOWN.top });
  });
});
