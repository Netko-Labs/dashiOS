import { expect, test } from "bun:test";
import { entrancesOf, row } from "../bench/dock-slide-read.ts";

const trace = (at: number, what: string): string => `[mirin-metal trace] ${at} ${what}`;
const frame = (at: number): string => trace(at, "render 2100x65 took 0.01ms, frame 0.50ms, retained subtrees 12 built");

const LOG = [
  "bench: in 1000",
  trace(1130, "render 1x65 took 0.02ms, frame 0.15ms"),
  trace(1150, "first content frame painted, 74ms after the host started"),
  frame(1150),
  trace(1166, "patch applied (2 ops) in 0.06ms"),
  trace(1182, "patch applied (2 ops) in 0.02ms"),
  frame(1198),
  trace(1214, "patch applied (2 ops) in 0.02ms"),
  frame(1246),
  "bench: out 2000",
  // The exit is not an entrance's.
  trace(2016, "patch applied (1 ops) in 0.02ms"),
  frame(2020),
  "bench: done 3000",
].join("\n");

test("an entrance is read from the edge to the pointer leaving: its first frame, patches, frames and gaps", () => {
  expect(entrancesOf(LOG)).toEqual([{ firstFrame: 150, patches: 3, frames: 3, gaps: [48, 48] }]);
});

test("an entrance whose Dock never drew is left out", () => {
  expect(entrancesOf("bench: in 1000\nbench: out 2000\n")).toEqual([]);
});

test("a row gives the medians and the worst gap", () => {
  expect(row("run", entrancesOf(LOG))).toBe("run | 1 | 150.0 | 3.0 | 3.0 | 48.0 | 48.0 | 48.0");
});
