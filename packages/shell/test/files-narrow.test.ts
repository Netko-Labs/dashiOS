import { expect, test } from "bun:test";
import { chromeFor, RAIL_WIDTH } from "../apps/files/lib/chrome.ts";
import { fitCrumbs } from "../apps/files/lib/omnibox/crumbs.tsx";
import { conflictMessage } from "../apps/files/lib/views/conflict-sheet.tsx";
import { fileColumns, fitColumns, NAME_FLOOR } from "../src/shared/file-browser/lib/sort.ts";
import { columnsFor, gridInset, whereLine } from "../src/shared/file-browser/lib/views/grid.tsx";
import { textWidth } from "../src/shared/file-browser/tile-name.ts";

// Review 54: Files in a small, narrow or tiled window.

const keys = (width: number, mode: "folder" | "locations" | "trash" = "folder"): string[] => fitColumns(fileColumns(mode), width).map((column) => column.key);

test("a narrow list drops Kind first, then the date, then Size, and Name keeps its floor", () => {
  expect(keys(0)).toEqual(["name", "modified", "size", "kind"]);
  expect(keys(800)).toEqual(["name", "modified", "size", "kind"]);
  expect(keys(482)).toEqual(["name", "modified", "size"]);
  expect(keys(343)).toEqual(["name", "size"]);
  expect(keys(200)).toEqual(["name"]);
  expect(keys(482, "locations")).toEqual(["name", "modified", "size"]);
  expect(keys(343, "trash")).toEqual(["name", "size"]);
  for (const width of [260, 343, 420, 482, 600, 800]) {
    const fixed = fitColumns(fileColumns("folder"), width).reduce((sum, column) => sum + (column.width ?? 0), 10);
    expect(width - fixed).toBeGreaterThanOrEqual(width >= NAME_FLOOR + 10 ? NAME_FLOOR : 0);
  }
});

test("the sidebar is a rail below 560 and New Folder leaves the toolbar below 480", () => {
  expect(chromeFor(0)).toEqual({ rail: false, compact: false });
  expect(chromeFor(1000)).toEqual({ rail: false, compact: false });
  expect(chromeFor(539)).toEqual({ rail: true, compact: false });
  expect(chromeFor(519)).toEqual({ rail: true, compact: false });
  expect(chromeFor(400)).toEqual({ rail: true, compact: true });
  expect(RAIL_WIDTH).toBe(56);
});

const crumbs = (names: string[], room: number): string[] =>
  fitCrumbs(
    names.map((name) => ({ name })),
    room,
  ).map((crumb) => (crumb.folded ? `…${crumb.segment.name}` : crumb.segment.name));

test("the path folds from the left to fit, and the current folder is never folded", () => {
  expect(crumbs(["Home", "Documents"], 0)).toEqual(["Home", "Documents"]);
  expect(crumbs(["Home", "Documents"], 400)).toEqual(["Home", "Documents"]);
  expect(crumbs(["Home", "Documents"], 120)).toEqual(["…Home", "Documents"]);
  expect(crumbs(["Home", "Documents"], 40)).toEqual(["Documents"]);
  const deep = ["Home", "Documents", "2026", "Alex Kim", "Design Review", "Drafts"];
  expect(crumbs(deep, 1000)).toEqual(["Home", "…2026", "Alex Kim", "Design Review", "Drafts"]);
  expect(crumbs(deep, 200)).toEqual(["Home", "…Design Review", "Drafts"]);
  expect(crumbs(deep, 120)).toEqual(["…Design Review", "Drafts"]);
  expect(crumbs([], 100)).toEqual([]);
});

test("the icon grid sits in the middle: the leftover width is split between its sides", () => {
  for (const width of [343, 462, 799, 1200]) {
    const inset = gridInset(width);
    const used = columnsFor(width) * 104;
    expect(inset).toBeGreaterThanOrEqual(10);
    expect(Math.abs(width - used - 2 * inset)).toBeLessThanOrEqual(1);
  }
  expect(gridInset(0)).toBe(10);
});

test("a search result's folder is cut once, in the middle, to fit under its tile", () => {
  const line = whereLine("~/Documents/2026/Clients/Alex Kim");
  expect(line.split("…")).toHaveLength(2);
  expect(line.startsWith("~/")).toBe(true);
  expect(line.endsWith("Kim")).toBe(true);
  expect(textWidth(line)).toBeLessThanOrEqual(9);
  expect(whereLine("~/Notes")).toBe("~/Notes");
});

test("the conflict message holds “the Trash.” together", () => {
  const conflict = { mode: "copy", existing: { folder: false } } as Parameters<typeof conflictMessage>[0];
  expect(conflictMessage(conflict)).toEndWith("goes to the Trash.");
});
