/**
 * How the live page draws a note: the spans of what its field shows
 * (project.ts) as the styled runs a Metal text field takes, in Dashi's type
 * scale (sizes.ts) and its palette. On the caret's lines markers are the
 * disabled ink, so `**` and `#` stay in the text but step back; elsewhere a
 * bullet's dot is muted, a table's rows and a rule's place have no ink (the
 * page draws them under the field), and a
 * ticked box is moss (done is not selected); the search's words sit on a
 * broth wash. Which runs take a press (a box, a link) comes back beside
 * them. Pure.
 */

import type { Palette } from "@dashi/ui";
import type { TextRun } from "@mirinjs/metal";
import type { Selection } from "./format.ts";
import type { Span } from "./markup.ts";
import type { Shown } from "./project.ts";
import { BODY_SIZE, headingSize } from "./sizes.ts";

export type Ink = Pick<Palette, "textMuted" | "textDisabled" | "moss" | "button" | "brothWash">;

/** A span that takes a press: a checklist box, or a link. */
export type Pressable = Extract<Span, { kind: "box" | "link" }>;

export interface Look {
  runs: TextRun[];
  /** By run index: the span a press on that run is for. */
  pressable: ReadonlyMap<number, Pressable>;
}

/** No ink: a table row's or a rule's place, drawn under the field. */
const CLEAR = "#00000000";

/** The size a table's row placeholder is drawn at, so the row is as tall as the drawn table's. */
export type RowSize = (table: number, rows: number) => number;

function runOf(span: Shown, ink: Ink, rowSize: RowSize): TextRun | null {
  const at = { start: span.start, end: span.end };
  switch (span.kind) {
    case "bullet":
      return { ...at, color: ink.textMuted };
    case "label":
      return { ...at, color: ink.textMuted, fontSize: 11 };
    case "rule":
      return { ...at, color: CLEAR };
    case "row":
      return { ...at, color: CLEAR, fontSize: rowSize(span.table, span.rows) };
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
      return { ...at, backgroundColor: ink.button, fontFamily: "monospace" };
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
export function lookOf(spans: readonly Shown[], ink: Ink, matches: readonly Selection[] = [], rowSize: RowSize = () => BODY_SIZE): Look {
  const runs: TextRun[] = [];
  const pressable = new Map<number, Pressable>();
  for (const span of spans) {
    const run = runOf(span, ink, rowSize);
    if (!run || run.end <= run.start) continue;
    if (span.kind === "box" || span.kind === "link") pressable.set(runs.length, span);
    runs.push(run);
  }
  for (const match of matches) runs.push({ start: match.start, end: match.end, backgroundColor: ink.brothWash });
  return { runs, pressable };
}
