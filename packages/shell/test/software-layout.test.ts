import { expect, test } from "bun:test";
import { columnsFor } from "../apps/software/cards.tsx";
import { ROW } from "../apps/software/parts.tsx";
import { COMPACT_BELOW, isCompact, SEARCH_MIN_WIDTH, SEARCH_WIDTH } from "../apps/software/toolbar-fit.ts";

// How Software fits a narrow window: cards keep their words, the toolbar keeps one row.

test("cards go to one column under 600 px, so a narrow window keeps each card's name and line", () => {
  // 520 × 400 and the left half of a 1098-point screen leave the grid 276 and 295 wide.
  expect(columnsFor(276)).toBe(1);
  expect(columnsFor(295)).toBe(1);
  // 680 wide leaves 436: still one, where two cards had 38 px for their words.
  expect(columnsFor(436)).toBe(1);
  expect(columnsFor(599)).toBe(1);
  expect(columnsFor(600)).toBe(2);
  expect(columnsFor(776)).toBe(2);
  expect(columnsFor(900)).toBe(3);
  expect(columnsFor(1300)).toBe(4);
});

test("the toolbar is compact when the page has less than 600 points", () => {
  expect(COMPACT_BELOW).toBe(600);
  expect(isCompact(320)).toBe(true);
  expect(isCompact(339)).toBe(true);
  expect(isCompact(599)).toBe(true);
  expect(isCompact(600)).toBe(false);
  expect(isCompact(820)).toBe(false);
});

test("compact at 520 wide, the row holds the activity chip and a search field no smaller than its least width", () => {
  // 320 for the page: 30 of padding, the spacer and two controls (20 of gaps), the short chip ("Installing 42%", about 90).
  const room = 320 - 30 - 20 - 90;
  expect(room).toBeGreaterThanOrEqual(SEARCH_MIN_WIDTH);
  expect(SEARCH_MIN_WIDTH).toBeLessThan(SEARCH_WIDTH);
});

test("every list row shares one geometry, and headings share its inset", () => {
  expect(ROW).toEqual({ icon: 44, minHeight: 60, inset: 13 });
});
