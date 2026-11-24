import { expect, test } from "bun:test";
import { SEARCH_FIELD, SIDEBAR_WIDTH } from "@dashi/ui";
import { columnsFor } from "../apps/software/lib/cards.tsx";
import { ROW } from "../apps/software/lib/parts.tsx";
import { COMPACT_BELOW, isCompact, STORE_LEAST } from "../apps/software/lib/toolbar-fit.ts";

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

test("at its least size the compact row holds both chips, a glyph button and the kit's search field at its least", () => {
  // The page at the least width: 18 and 12 of insets, Back, five gaps, "Offline" (about 80), "Installing 42%" (about 90), a glyph button.
  const room = STORE_LEAST.width - SIDEBAR_WIDTH - 30 - 32 - 50 - 80 - 90 - 32;
  expect(room).toBeGreaterThanOrEqual(SEARCH_FIELD.least);
  expect(isCompact(STORE_LEAST.width - SIDEBAR_WIDTH)).toBe(true);
  expect(STORE_LEAST.height).toBeGreaterThanOrEqual(400);
});

test("every list row shares one geometry, and headings share its inset", () => {
  expect(ROW).toEqual({ icon: 44, minHeight: 60, inset: 13 });
});
