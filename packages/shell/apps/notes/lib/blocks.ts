/**
 * A note's blocks, as the page reveals them: a fenced code block and a table
 * are one block each (the caret anywhere in one shows all of its source),
 * every other line is a block of its own. Which lines show their source: the
 * blocks the caret or the selection touches. Pure.
 */

import { continuesTable, startsTable } from "../../../src/shared/markdown/index.ts";
import { FENCE } from "./markup.ts";

export type BlockKind = "line" | "fence" | "table";

/** Lines `from` to `to` (both included, 0-based). */
export interface Block {
  kind: BlockKind;
  from: number;
  to: number;
}

export interface Lines {
  from: number;
  to: number;
}

/** The blocks of `lines`, in order, covering every line. */
export function blocksOf(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (FENCE.test(line)) {
      const marker = FENCE.exec(line)?.[1] ?? "```";
      let end = at + 1;
      while (end < lines.length && !(lines[end] ?? "").trimStart().startsWith(marker)) end++;
      const to = Math.min(end, lines.length - 1);
      blocks.push({ kind: "fence", from: at, to });
      at = to + 1;
    } else if (startsTable(lines, at)) {
      let end = at + 2;
      while (end < lines.length && continuesTable(lines[end] ?? "")) end++;
      blocks.push({ kind: "table", from: at, to: end - 1 });
      at = end;
    } else {
      blocks.push({ kind: "line", from: at, to: at });
      at++;
    }
  }
  return blocks;
}

/** Where each line starts in the body. */
export function lineStarts(lines: readonly string[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const line of lines) {
    starts.push(at);
    at += line.length + 1;
  }
  return starts;
}

/** The line holding body offset `offset` (a caret at a line's end is on that line). */
export function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((starts[middle] ?? 0) <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The block that holds `line`. */
export function blockOf(blocks: readonly Block[], line: number): Block {
  let low = 0;
  let high = blocks.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((blocks[middle]?.from ?? 0) <= line) low = middle;
    else high = middle - 1;
  }
  return blocks[low] ?? { kind: "line", from: line, to: line };
}

/** The lines that show their source for a selection from `start` to `end`: every block it touches. */
export function revealedLines(body: string, start: number, end: number): Lines {
  const lines = body.split("\n");
  const starts = lineStarts(lines);
  const blocks = blocksOf(lines);
  const first = blockOf(blocks, lineOf(starts, Math.min(start, end)));
  const last = blockOf(blocks, lineOf(starts, Math.max(start, end)));
  return { from: first.from, to: last.to };
}
