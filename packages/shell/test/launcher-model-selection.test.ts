import { describe, expect, test } from "bun:test";
import { KEYMAP } from "../src/keymap.ts";
import { LAUNCHER_RULES, LauncherKeys, withLauncher } from "../src/launcher/keys.ts";
import { keepInView, moveSelection, resolveSelection, wheelSteps } from "../src/launcher/selection.ts";

describe("selection by id", () => {
  const ids = ["a", "b", "c", "d", "e", "f", "g"];

  test("held while listed, else the first row", () => {
    expect(resolveSelection(ids, "c")).toBe("c");
    expect(resolveSelection(ids, "gone")).toBe("a");
    expect(resolveSelection([], "a")).toBeNull();
    // Rows arriving below don't move it; rows above don't either: it's an id.
    expect(resolveSelection(["new", ...ids, "late"], "c")).toBe("c");
  });

  test("↑ ↓ wrap; pages stop at the ends; first and last", () => {
    expect(moveSelection(ids, "g", "down")).toBe("a");
    expect(moveSelection(ids, "a", "up")).toBe("g");
    expect(moveSelection(ids, "b", "page-down", 5)).toBe("g");
    expect(moveSelection(ids, "f", "page-down", 5)).toBe("g");
    expect(moveSelection(ids, "c", "page-up", 5)).toBe("a");
    expect(moveSelection(ids, "c", "first")).toBe("a");
    expect(moveSelection(ids, "c", "last")).toBe("g");
    expect(moveSelection([], null, "down")).toBeNull();
  });

  test("a long list scrolls just enough to keep the selection drawn", () => {
    expect(keepInView(0, 0, 8, 20)).toBe(0);
    expect(keepInView(8, 0, 8, 20)).toBe(1);
    expect(keepInView(19, 0, 8, 20)).toBe(12);
    expect(keepInView(3, 10, 8, 20)).toBe(3);
    expect(keepInView(5, 3, 8, 6)).toBe(0);
  });
});

describe("keys while the launcher is open", () => {
  test("its rules come first and go with it", () => {
    const keymap = withLauncher(KEYMAP);
    expect(keymap.rules.slice(0, LAUNCHER_RULES.length)).toEqual(LAUNCHER_RULES);
    expect(keymap.rules.slice(LAUNCHER_RULES.length)).toEqual(KEYMAP.rules);
    expect(LAUNCHER_RULES.map((rule) => rule.when)).toEqual(expect.arrayContaining(["ctrl+n", "ctrl+p", "Home", "End"]));
  });

  test("bindings move the open launcher's selection; others are not its", () => {
    const keys = new LauncherKeys();
    const moves: string[] = [];
    const stop = keys.subscribe((move) => moves.push(move));
    expect(keys.binding("launcher-page-down")).toBe(true);
    expect(keys.binding("launcher-up")).toBe(true);
    expect(keys.binding("quit-app")).toBe(false);
    stop();
    keys.binding("launcher-down");
    expect(moves).toEqual(["page-down", "up"]);
  });
});

describe("the wheel over the list", () => {
  test("a line toward the end is a row down, toward the start a row up; a touchpad's small steps add up", () => {
    expect(wheelSteps(0, -1)).toEqual({ steps: 1, rest: 0 });
    expect(wheelSteps(0, 3)).toEqual({ steps: -3, rest: 0 });
    let rest = 0;
    let moved = 0;
    for (const dy of [-0.4, -0.4, -0.4]) {
      const next = wheelSteps(rest, dy);
      moved += next.steps;
      rest = next.rest;
    }
    expect(moved).toBe(1);
    expect(rest).toBeCloseTo(-0.2);
  });
});
