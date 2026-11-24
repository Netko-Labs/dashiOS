import { expect, test } from "bun:test";
import { INK_SLIDER, valueBoxWidth, valueOnInk } from "../src/panel/ink-slider.tsx";

// The ink slider's value takes one colour, never two halves split at the fill's edge (SE-A44).

test("the value turns to the ink's colour, all of it, once the fill reaches its start", () => {
  const width = INK_SLIDER.width;
  const words = 70;
  // Its words start 14 + 70 in from the end: 176 on a 260 track.
  expect(valueOnInk(175, width, words)).toBe(false);
  expect(valueOnInk(176, width, words)).toBe(true);
  expect(valueOnInk(width, width, words)).toBe(true);
  expect(valueOnInk(0, width, words)).toBe(false);
});

test("before its words are measured, the value stays muted", () => {
  expect(valueOnInk(INK_SLIDER.width, INK_SLIDER.width, 0)).toBe(false);
});

test("on the ink, the value ends where the fill ends, so none of it lies past the fill's edge", () => {
  const width = INK_SLIDER.width;
  // Muted on the track: the whole slider, the value at its right.
  expect(valueBoxWidth(150, width, false)).toBe(width);
  // On the ink, part way: the box is the fill, the value right-aligned inside it.
  expect(valueBoxWidth(200, width, true)).toBe(200);
  // Full: the whole slider again.
  expect(valueBoxWidth(width, width, true)).toBe(width);
});
