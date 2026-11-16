/**
 * Typing that makes structure, beside Return in a list (format.ts's
 * `continueList`): "[] " at a line's start becomes a checklist item, Tab in a
 * list item indents the item (not a tab in its words), Return after an
 * opening fence closes it below, and Format › Indent and Outdent move the
 * lines a level, and Mark as Done ticks the boxes. Each takes what the body was, what typing made it, and
 * where the caret was, and gives back the body and caret, or null when the
 * typing was no such thing. Pure.
 */

import type { Edited, Selection } from "./format.ts";
import { BULLET, CHECK, FENCE, NUMBER } from "./markup.ts";

/** `after` is `before` with `typed` put in at `at`. */
const inserted = (before: string, after: string, at: number, typed: string): boolean =>
  at >= 0 && at <= before.length && after.length === before.length + typed.length && after === before.slice(0, at) + typed + before.slice(at);

const lineStart = (body: string, at: number): number => body.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (body: string, at: number): number => (body.indexOf("\n", at) < 0 ? body.length : body.indexOf("\n", at));

/** How far a list item's line moves for one level: under its words' start. */
function indentUnit(line: string): string | null {
  if (CHECK.test(line) || BULLET.test(line)) return "  ";
  const number = NUMBER.exec(line);
  return number ? " ".repeat((number[2]?.length ?? 2) + 1) : null;
}

/** "[] " or "- [] " typed at a line's start: a checklist item, the caret after its box. */
function boxTyped(before: string, after: string, at: number): Edited | null {
  if (!inserted(before, after, at, " ")) return null;
  const start = lineStart(after, at);
  const typed = /^([ \t]*)(?:[-*+][ \t]+)?\[ ?\]$/.exec(after.slice(start, at));
  if (!typed) return null;
  const item = `${typed[1] ?? ""}- [ ] `;
  const body = after.slice(0, start) + item + after.slice(at + 1);
  if (body === after) return null;
  return { body, selection: { start: start + item.length, end: start + item.length } };
}

/** Tab typed in a list item: the item moves a level in, the tab is not typed. */
function tabTyped(before: string, after: string, at: number): Edited | null {
  if (!inserted(before, after, at, "\t")) return null;
  const start = lineStart(before, at);
  const unit = indentUnit(before.slice(start, lineEnd(before, at)));
  if (unit === null) return null;
  const body = before.slice(0, start) + unit + before.slice(start);
  return { body, selection: { start: at + unit.length, end: at + unit.length } };
}

/** Return at the end of an opening fence (```ts) with no fence below: the closing one goes in, the caret on the line between. */
function fenceOpened(before: string, after: string, at: number): Edited | null {
  if (!inserted(before, after, at, "\n")) return null;
  const start = lineStart(before, at);
  const line = before.slice(start, at);
  const fence = /^([ \t]*)(```|~~~)[^`]*$/.exec(line);
  if (!fence || before.slice(at, lineEnd(before, at)).trim() !== "") return null;
  const lines = before.split("\n");
  const index = before.slice(0, start).split("\n").length - 1;
  const above = lines.slice(0, index).filter((each) => FENCE.test(each)).length;
  const below = lines.slice(index + 1).some((each) => FENCE.test(each));
  if (above % 2 === 1 || below) return null;
  const close = `\n${fence[1] ?? ""}${fence[2] ?? "```"}`;
  const caret = at + 1;
  return { body: after.slice(0, caret) + close + after.slice(caret), selection: { start: caret, end: caret } };
}

/** Typing that makes structure (see the file's comment), or null. */
export function structure(before: string, after: string, at: number): Edited | null {
  return boxTyped(before, after, at) ?? tabTyped(before, after, at) ?? fenceOpened(before, after, at);
}

/** Format › Indent or Outdent: every list item the selection touches moves a level (other lines a tab stop of two spaces). */
export function indentLines(body: string, selection: Selection, way: 1 | -1): Edited {
  const low = Math.min(selection.start, selection.end);
  const high = Math.max(selection.start, selection.end);
  const from = lineStart(body, low);
  const to = lineEnd(body, high);
  const lines = body.slice(from, to).split("\n");
  const changed = lines.map((line) => {
    const unit = indentUnit(line) ?? "  ";
    if (way === 1) return line.trim() === "" ? line : unit + line;
    if (line.startsWith("\t")) return line.slice(1);
    const spaces = /^ */.exec(line)?.[0].length ?? 0;
    return line.slice(Math.min(spaces, unit.length));
  });
  const out = body.slice(0, from) + changed.join("\n") + body.slice(to);
  // The caret keeps its place in the words: it moves by what changed on the lines up to it.
  const move = (at: number): number => {
    let old = from;
    let shift = 0;
    for (const [index, line] of lines.entries()) {
      const delta = (changed[index] ?? line).length - line.length;
      if (at <= old + line.length) return Math.max(from + shift + (old - from), at + shift + delta);
      shift += delta;
      old += line.length + 1;
    }
    return at + shift;
  };
  return { body: out, selection: { start: move(selection.start), end: move(selection.end) } };
}

/** Format › Mark as Done: the checklist items the selection touches are ticked, or unticked when they all are; other lines stay. */
export function tickLines(body: string, selection: Selection): Edited {
  const from = lineStart(body, Math.min(selection.start, selection.end));
  const to = lineEnd(body, Math.max(selection.start, selection.end));
  const lines = body.slice(from, to).split("\n");
  const items = lines.map((line) => CHECK.exec(line));
  const allDone = items.every((item) => item === null || item[4] !== " ");
  const changed = lines.map((line, index) => {
    const item = items[index];
    if (!item) return line;
    const at = item[0].length - 2;
    return line.slice(0, at) + (allDone ? " " : "x") + line.slice(at + 1);
  });
  return { body: body.slice(0, from) + changed.join("\n") + body.slice(to), selection };
}
