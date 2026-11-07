/**
 * What the window says about its document beside the title, on the same
 * line and muted: the folder, the counts or Find's place, and an encoding
 * or line ending that isn't UTF-8 and LF; and Find's matches as the text's
 * highlights.
 */

import type { TextHighlight } from "@mirinjs/metal";
import { ENCODING_LABELS, type Encoding, LINE_ENDING_LABELS, type LineEnding } from "./codec.ts";
import type { FindState } from "./model.ts";

/** Find's place: "Not found", "12 matches", "3 of 12 · line 40"; null without a query. */
export function findStatus(find: FindState, lineOfCurrent: () => number): string | null {
  if (find.query === "") return null;
  const count = find.matches.length;
  if (count === 0) return "Not found";
  if (find.current < 0) return `${count.toLocaleString("en-US")} ${count === 1 ? "match" : "matches"}`;
  return `${(find.current + 1).toLocaleString("en-US")} of ${count.toLocaleString("en-US")} · line ${lineOfCurrent().toLocaleString("en-US")}`;
}

export interface StatusParts {
  /** The folder the file is in (`~/Documents`), or null for a draft. */
  folder: string | null;
  /** Find's place, or the counts. */
  place: string;
  encoding: Encoding;
  lineEnding: LineEnding;
}

/** The muted words after the title: "~/Documents · 3 of 12 · line 40", "Draft · 2 words". */
export function statusLine({ folder, place, encoding, lineEnding }: StatusParts): string {
  const unusual = encoding === "utf-8" && lineEnding === "lf" ? null : `${ENCODING_LABELS[encoding]} · ${LINE_ENDING_LABELS[lineEnding]}`;
  return [folder ?? "Draft", place, unusual].filter((part) => part !== null && part !== "").join(" · ");
}

/** Every match washed in `wash`, the one Find is on in `current`. */
export function findHighlights(find: FindState, wash: string, current: string): TextHighlight[] {
  const length = find.query.length;
  if (length === 0) return [];
  return find.matches.map((start, index) => ({ start, end: start + length, color: index === find.current ? current : wash }));
}
