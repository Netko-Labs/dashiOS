import { expect, test } from "bun:test";
import { rawFor, steppedValue } from "../src/system/brightness.ts";

const light = (value: number) => ({ name: "amdgpu_bl1", value, max: 400 });

test("the keys step down to off and back up", () => {
  expect(steppedValue(light(25), "down")).toBe(0);
  expect(steppedValue(light(0), "down")).toBe(0);
  expect(steppedValue(light(0), "up")).toBe(25);
  expect(steppedValue(light(400), "up")).toBe(400);
  // Between steps: down to the step below.
  expect(steppedValue(light(40), "down")).toBe(25);
});

test("the slider reaches off at its left end", () => {
  expect(rawFor(light(200), 0)).toBe(0);
  expect(rawFor(light(200), 0.5)).toBe(200);
  expect(rawFor(light(200), 2)).toBe(400);
});
