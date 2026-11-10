/**
 * How the live page draws a note's Markdown: its spans (markup.ts) as the
 * styled runs a Metal text field takes, in Dashi's type scale (design.html
 * TY-1: the body 13, headings 20, 17 and 15) and its palette. Markers are
 * the disabled ink, so `**` and `#` stay in the text but step back; a
 * ticked box is moss (done is not selected); the search's words sit on a
 * broth wash. Which runs take a press (a box, a link) comes back beside
 * them. Pure.
 */

import type { Palette } from "@dashi/ui";
import type { TextRun } from "@mirinjs/metal";
import type { Selection } from "./format.ts";
import type { Span } from "./markup.ts";

/** The body's size, and a heading's by level (TY-1). */
export const BODY_SIZE = 13;
export const TITLE_SIZE = 20;
const HEADING_SIZES: readonly number[] = [20, 17, 15];

/** The size a heading of `level` is drawn at. */
export const headingSize = (level: number): number => HEADING_SIZES[level - 1] ?? BODY_SIZE;

export type Ink = Pick<Palette, "textMuted" | "textDisabled" | "moss" | "button" | "brothWash">;

/** A span that takes a press: a checklist box, or a link. */
export type Pressable = Extract<Span, { kind: "box" | "link" }>;

export interface Look {
  runs: TextRun[];
  /** By run index: the span a press on that run is for. */
  pressable: ReadonlyMap<number, Pressable>;
}

function runOf(span: Span, ink: Ink): TextRun | null {
  const at = { start: span.start, end: span.end };
  switch (span.kind) {
    case "marker":
      return { ...at, color: ink.textDisabled };
    case "heading":
      return { ...at, fontWeight: "bold", fontSize: headingSize(span.level) };
    case "bold":
      return { ...at, fontWeight: "bold" };
    case "italic":
      return { ...at, fontStyle: "italic" };
    case "strike":
      return { ...at, textDecorationLine: "line-through" };
    case "code":
      return { ...at, backgroundColor: ink.button };
    case "quote":
      return { ...at, color: ink.textMuted, fontStyle: "italic" };
    case "done":
      return { ...at, color: ink.textMuted, textDecorationLine: "line-through" };
    case "box":
      return { ...at, color: span.checked ? ink.moss : ink.textMuted, fontWeight: "bold", press: true };
    case "link":
      return { ...at, textDecorationLine: "underline", press: true };
  }
}

/** The runs for `spans`, then a wash on each of `matches` (Find). */
export function lookOf(spans: readonly Span[], ink: Ink, matches: readonly Selection[] = []): Look {
  const runs: TextRun[] = [];
  const pressable = new Map<number, Pressable>();
  for (const span of spans) {
    const run = runOf(span, ink);
    if (!run || run.end <= run.start) continue;
    if (span.kind === "box" || span.kind === "link") pressable.set(runs.length, span);
    runs.push(run);
  }
  for (const match of matches) runs.push({ start: match.start, end: match.end, backgroundColor: ink.brothWash });
  return { runs, pressable };
}

/** Each line of `body` with the size it is drawn at (a heading's, else the body's), for the copy that measures it. */
export function lineSizes(body: string): Array<{ text: string; size: number }> {
  let fenced = false;
  return body.split("\n").map((text) => {
    if (/^[ \t]*(```|~~~)/.test(text)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})[ \t]+/.exec(text);
    return { text, size: heading ? headingSize(heading[1]?.length ?? 1) : BODY_SIZE };
  });
}
