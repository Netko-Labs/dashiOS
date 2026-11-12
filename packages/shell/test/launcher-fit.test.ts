import { expect, test } from "bun:test";
import { fitToRoom, listHeight } from "../src/launcher/lib/fit.ts";
import type { Row } from "../src/launcher/row-model.ts";
import type { Section } from "../src/launcher/sections.ts";

const row = (id: string): Row => ({ id, title: id, kind: "", icon: { glyph: "" }, action: { kind: "all-apps" } }) as Row;
const section = (id: string, ids: string[], extra: Partial<Section> = {}): Section => ({ id, title: id, rows: ids.map(row), ...extra });
const shape = (sections: Section[]) => sections.map((each) => [each.id, each.rows.map((r) => r.id)]);

// Rows 60 tall and heads 25, as at the largest text size.
const ROW = 60;
const HEAD = 25;

test("rows from outside that would run past the panel are cut from the end; what fits stays", () => {
  const sections = [section("top", ["text-editor"]), section("files", ["a", "b", "c"]), section("slow:characters", ["x", "y", "z"])];
  expect(listHeight(sections, ROW, HEAD)).toBe(3 * HEAD + 7 * ROW);
  const fitted = fitToRoom(sections, { height: 400, row: ROW, head: HEAD });
  expect(shape(fitted)).toEqual([
    ["top", ["text-editor"]],
    ["files", ["a", "b", "c"]],
    ["slow:characters", ["x"]],
  ]);
  expect(listHeight(fitted, ROW, HEAD)).toBeLessThanOrEqual(400);
});

test("a section left empty goes; All apps and Ask are never cut", () => {
  const sections = [
    section("now", ["task"]),
    section("recent", ["notes", "files", "terminal", "all-apps"]),
    section("slow:characters", ["x"]),
    { id: "ask", rows: [row("ask")] },
  ];
  const fitted = fitToRoom(sections, { height: 2 * HEAD + 4 * ROW, row: ROW, head: HEAD });
  expect(shape(fitted)).toEqual([
    ["now", ["task"]],
    ["recent", ["notes", "all-apps"]],
    ["ask", ["ask"]],
  ]);
});

test("a scope's scrolled list keeps its window; what fits already is left as it is", () => {
  const scoped = [section("clipboard", ["1", "2", "3", "4", "5", "6", "7", "8", "9"], { window: 3 })];
  expect(fitToRoom(scoped, { height: 1000, row: ROW, head: HEAD })).toEqual(scoped);
  expect(shape(fitToRoom(scoped, { height: 100, row: ROW, head: HEAD }))).toEqual(shape(scoped));
});
