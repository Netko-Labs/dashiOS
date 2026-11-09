/**
 * What the window says about its document: its folder after the title, on
 * the same line and muted; Find's place inside the Find field; the counts,
 * and an encoding or line ending that isn't UTF-8 and LF, in a quiet chip
 * at the text's foot; and Find's matches as the text's highlights.
 */

import type { TextHighlight } from "@mirinjs/metal";
import { ENCODING_LABELS, type Encoding, LINE_ENDING_LABELS, type LineEnding } from "./codec.ts";
import type { FindState } from "./model.ts";

/** Find's place, short enough for the field it is in: "Not found", "12 matches", "3 of 12"; null without a query. */
export function findPlace(find: FindState): string | null {
  if (find.query === "") return null;
  const count = find.matches.length;
  if (count === 0) return "Not found";
  if (find.current < 0) return `${count.toLocaleString("en-US")} ${count === 1 ? "match" : "matches"}`;
  return `${(find.current + 1).toLocaleString("en-US")} of ${count.toLocaleString("en-US")}`;
}

/** The muted words after the title: the folder the file is in (`~/Documents`), or Draft before it has one. */
export function titleDetail(folder: string | null): string {
  return folder ?? "Draft";
}

export interface CountsParts {
  /** "12 lines · 80 words · 412 characters" (stats.ts). */
  counts: string;
  encoding: Encoding;
  lineEnding: LineEnding;
}

/** The chip at the text's foot: the counts, and the encoding and line ending when they are unusual. */
export function countsLine({ counts, encoding, lineEnding }: CountsParts): string {
  const unusual = encoding === "utf-8" && lineEnding === "lf" ? null : `${ENCODING_LABELS[encoding]} · ${LINE_ENDING_LABELS[lineEnding]}`;
  return [counts, unusual].filter((part) => part !== null && part !== "").join(" · ");
}

/** Every match washed in `wash`, the one Find is on in `current`. */
export function findHighlights(find: FindState, wash: string, current: string): TextHighlight[] {
  const length = find.query.length;
  if (length === 0) return [];
  return find.matches.map((start, index) => ({ start, end: start + length, color: index === find.current ? current : wash }));
}
