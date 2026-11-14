import { expect, test } from "bun:test";
import type { Modifiers } from "@mirinjs/metal";
import {
  clampTo,
  clip,
  combine,
  EDGE,
  hitsIn,
  isDrag,
  lastTaken,
  MAX_STEP,
  modeOf,
  rectBetween,
  scrollStep,
  stepWithin,
  touches,
} from "../src/shared/file-browser/lib/marquee/geometry.ts";
import { gridHeight, tileRects } from "../src/shared/file-browser/lib/views/grid.tsx";
import { rowRects } from "../src/shared/file-browser/lib/views/list.tsx";

const none: Modifiers = { shift: false, control: false, alt: false, super: false };
const shift: Modifiers = { ...none, shift: true };
const command: Modifiers = { ...none, super: true };

// --- The geometry ---------------------------------------------------------------------

test("a press that moves less than the threshold is a click", () => {
  expect(isDrag({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
  expect(isDrag({ x: 10, y: 10 }, { x: 14, y: 10 })).toBe(true);
  expect(isDrag({ x: 10, y: 10 }, { x: 10, y: 5 })).toBe(true);
});

test("the rectangle is between the two corners, whichever way it was dragged", () => {
  expect(rectBetween({ x: 30, y: 40 }, { x: 10, y: 90 })).toEqual({ x: 10, y: 40, width: 20, height: 50 });
  expect(rectBetween({ x: 10, y: 90 }, { x: 30, y: 40 })).toEqual({ x: 10, y: 40, width: 20, height: 50 });
});

test("it takes every item it touches, an edge included, and none it only passes", () => {
  const rects = tileRects(6, 2 * 10 + 3 * 104, 98);
  // Three across: the second row starts under the first, a gap of 4 below it.
  expect(rects[0]).toEqual({ x: 10, y: 10, width: 104, height: 98 });
  expect(rects[4]).toEqual({ x: 114, y: 112, width: 104, height: 98 });
  expect(hitsIn(rects, { x: 100, y: 50, width: 30, height: 70 })).toEqual([0, 1, 3, 4]);
  // In the gap between the rows it touches neither.
  expect(hitsIn(rects, { x: 0, y: 109, width: 400, height: 2 })).toEqual([]);
  expect(touches({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
  expect(touches({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 5, height: 5 })).toBe(false);
});

test("the tiles sit in the middle of a width they don't fill, and the rows of a list run its width", () => {
  // 30 left over by two tiles: 15 more at each side.
  expect(tileRects(2, 2 * 10 + 2 * 104 + 30, 98).map((rect) => rect.x)).toEqual([25, 129]);
  expect(gridHeight(5, 2 * 10 + 2 * 104, 98)).toBe(2 * 10 + 3 * 98 + 2 * 4);
  expect(rowRects(3, 400)).toEqual([
    { x: 5, y: 0, width: 390, height: 26 },
    { x: 5, y: 26, width: 390, height: 26 },
    { x: 5, y: 52, width: 390, height: 26 },
  ]);
});

test("what is drawn stays inside the listing, and the pointer is brought to its edge", () => {
  const frame = { x: 0, y: 100, width: 300, height: 200 };
  expect(clip({ x: 50, y: 20, width: 100, height: 150 }, frame)).toEqual({ x: 50, y: 100, width: 100, height: 70 });
  expect(clip({ x: 50, y: 0, width: 100, height: 50 }, frame)).toBeNull();
  expect(clampTo({ x: 400, y: 50 }, frame)).toEqual({ x: 300, y: 100 });
});

test("the item taken last is the one nearest the moving corner", () => {
  const rects = rowRects(5, 400);
  expect(lastTaken(rects, [1, 2, 3], { x: 100, y: 95 })).toBe(3);
  expect(lastTaken(rects, [1, 2, 3], { x: 100, y: 30 })).toBe(1);
  expect(lastTaken(rects, [], { x: 0, y: 0 })).toBeNull();
});

// --- The keys ------------------------------------------------------------------------

test("the keys mean what they mean for a click: none replaces, ⇧ adds, ❖ or Ctrl toggles", () => {
  expect(modeOf(none)).toBe("replace");
  expect(modeOf(shift)).toBe("add");
  expect(modeOf(command)).toBe("toggle");
  expect(modeOf({ ...none, control: true })).toBe("toggle");
  // ⇧❖-click adds a run; ⇧❖-drag adds too.
  expect(modeOf({ ...shift, super: true })).toBe("add");
});

test("a plain drag replaces the selection, ⇧ adds to it, ❖ toggles against what was selected before", () => {
  const base = ["a", "b"];
  expect(combine(base, ["b", "c"], "replace")).toEqual(["b", "c"]);
  expect(combine(base, ["b", "c"], "add")).toEqual(["a", "b", "c"]);
  expect(combine(base, ["b", "c"], "toggle")).toEqual(["a", "c"]);
  // The rectangle leaves b: it is selected again, as before the drag.
  expect(combine(base, ["c"], "toggle")).toEqual(["a", "b", "c"]);
  expect(combine(base, [], "replace")).toEqual([]);
});

// --- Scrolling at the edges -------------------------------------------------------------

test("it scrolls only at the top and bottom edges, faster the further past them, up to a limit", () => {
  expect(scrollStep(200, 100, 400)).toBe(0);
  expect(scrollStep(400 - EDGE, 100, 400)).toBe(0);
  const inside = scrollStep(395, 100, 400);
  const past = scrollStep(460, 100, 400);
  expect(inside).toBeGreaterThan(0);
  expect(past).toBeGreaterThan(inside);
  expect(scrollStep(4000, 100, 400)).toBe(MAX_STEP);
  expect(scrollStep(40, 100, 400)).toBeLessThan(scrollStep(105, 100, 400));
  expect(scrollStep(105, 100, 400)).toBeLessThan(0);
});

test("a step stops at the listing's start and end", () => {
  expect(stepWithin(-20, 5, 300)).toBe(-5);
  expect(stepWithin(20, 290, 300)).toBe(10);
  expect(stepWithin(20, 100, 300)).toBe(20);
  // Nothing to scroll over: it stays.
  expect(stepWithin(20, 0, -50)).toBe(0);
});
