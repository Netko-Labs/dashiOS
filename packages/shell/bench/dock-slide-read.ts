/**
 * Reads a log of bench/dock-slide.tsx: for each entrance, how long from the
 * pointer reaching the edge to the Dock's first frame, and through the slide
 * how many patches the Dock sent, how many frames its host drew, and the
 * gaps between those frames.
 *
 *   bun bench/dock-slide-read.ts <log> [<log>…]      one table row per log
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";

interface Entrance {
  /** Pointer at the edge to the first frame with the Dock in it, ms. */
  firstFrame: number;
  patches: number;
  frames: number;
  /** Between one frame of the slide and the next, ms. */
  gaps: number[];
}

const TRACE = /^\[mirin-metal trace\] (\d+(?:\.\d+)?) (.*)$/;

/** The entrances of one log: what lies between each `bench: in` and its `bench: out`. */
export function entrancesOf(text: string): Entrance[] {
  const entrances: Entrance[] = [];
  let began: number | null = null;
  let first: number | null = null;
  let patches = 0;
  let frames: number[] = [];
  for (const line of text.split("\n")) {
    const mark = /^bench: (in|out) (\d+)$/.exec(line);
    if (mark) {
      if (mark[1] === "in") {
        began = Number(mark[2]);
        first = null;
        patches = 0;
        frames = [];
      } else if (began !== null && first !== null) {
        const gaps = frames.slice(1).map((at, index) => at - (frames[index] as number));
        entrances.push({ firstFrame: first - began, patches, frames: frames.length, gaps });
        began = null;
      }
      continue;
    }
    const trace = TRACE.exec(line);
    if (!trace || began === null) continue;
    const at = Number(trace[1]);
    const what = trace[2] as string;
    if (what.startsWith("first content frame painted")) first = at;
    // The frames and patches of the slide: from the first frame with the Dock in it.
    else if (first !== null && what.startsWith("patch applied")) patches += 1;
    else if (first !== null && what.startsWith("render ") && frames.at(-1) !== at) frames.push(at);
  }
  return entrances;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? Number.NaN : (sorted[Math.floor((sorted.length - 1) / 2)] as number);
};
const one = (value: number): string => (Number.isNaN(value) ? "n/a" : value.toFixed(1));

/** One row: medians over the entrances, and the worst gap of any. */
export function row(name: string, entrances: Entrance[]): string {
  const gaps = entrances.flatMap((entrance) => entrance.gaps);
  const worst = entrances.map((entrance) => Math.max(0, ...entrance.gaps));
  return [
    name,
    String(entrances.length),
    one(median(entrances.map((entrance) => entrance.firstFrame))),
    one(median(entrances.map((entrance) => entrance.patches))),
    one(median(entrances.map((entrance) => entrance.frames))),
    one(median(gaps)),
    one(median(worst)),
    one(Math.max(0, ...worst)),
  ].join(" | ");
}

if (import.meta.main) {
  console.log(
    "run | entrances | edge to first frame, ms | patches | frames | gap between frames, ms (median) | longest gap, ms (median) | longest gap, ms (worst)",
  );
  console.log("--- | --- | --- | --- | --- | --- | --- | ---");
  for (const path of process.argv.slice(2)) console.log(row(basename(path, ".log"), entrancesOf(readFileSync(path, "utf8"))));
}
