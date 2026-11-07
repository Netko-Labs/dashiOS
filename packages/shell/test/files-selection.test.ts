import { expect, test } from "bun:test";
import type { Modifiers } from "@mirinjs/metal";
import { isPlain, pick } from "../apps/files/selection.ts";

const shown = ["a", "b", "c", "d", "e"];
const none: Modifiers = { shift: false, control: false, alt: false, super: false };
const shift: Modifiers = { ...none, shift: true };
const command: Modifiers = { ...none, super: true };

test("a plain click selects the one item and sets the anchor", () => {
  expect(pick(shown, ["a", "c"], "a", "d", none)).toEqual({ selection: ["d"], anchor: "d" });
});

test("⇧-click selects the run from the anchor, either way, and keeps the anchor", () => {
  expect(pick(shown, ["b"], "b", "d", shift)).toEqual({ selection: ["b", "c", "d"], anchor: "b" });
  expect(pick(shown, ["b", "c", "d"], "b", "a", shift)).toEqual({ selection: ["a", "b"], anchor: "b" });
  // Without an anchor (or one no longer shown) it is a plain click.
  expect(pick(shown, [], null, "c", shift)).toEqual({ selection: ["c"], anchor: "c" });
  expect(pick(shown, ["z"], "z", "c", shift)).toEqual({ selection: ["c"], anchor: "c" });
});

test("❖-click (or Ctrl-click) adds or takes out one item", () => {
  expect(pick(shown, ["a"], "a", "c", command)).toEqual({ selection: ["a", "c"], anchor: "c" });
  expect(pick(shown, ["a", "c"], "c", "a", command)).toEqual({ selection: ["c"], anchor: "a" });
  expect(pick(shown, ["a"], "a", "e", { ...none, control: true })).toEqual({ selection: ["a", "e"], anchor: "e" });
});

test("⇧❖-click adds the run to what was selected", () => {
  expect(pick(shown, ["a", "c"], "c", "e", { ...shift, super: true })).toEqual({ selection: ["a", "c", "d", "e"], anchor: "c" });
});

test("only a click with no keys held is plain (a second one opens)", () => {
  expect(isPlain(none)).toBe(true);
  expect(isPlain(shift)).toBe(false);
  expect(isPlain(command)).toBe(false);
  expect(isPlain({ ...none, alt: true })).toBe(false);
});
