/**
 * The text a PDF selection copies: the first and last pages word by word (a
 * selection starts and ends mid-page), and a long run between them as plain
 * text in one read. Pages whose words aren't read yet are read now.
 */

import { selectedText } from "../text.ts";
import type { Viewer } from "../viewer.ts";
import { rangeOf, type Selection } from "./pdf-selection.ts";

/** A copy across more pages than this reads the pages between its ends as plain text. */
const LONG_RUN = 8;

export async function copiedText(selection: Selection | null, pdfOpen: boolean, source: Pick<Viewer, "textOf" | "plainText">): Promise<string> {
  if (!selection || !pdfOpen) return "";
  const from = Math.min(selection.anchor.page, selection.focus.page);
  const to = Math.max(selection.anchor.page, selection.focus.page);
  const long = to - from > LONG_RUN;
  const all = await source.textOf(long ? [from, to] : Array.from({ length: to - from + 1 }, (_, index) => from + index));
  const whole = rangeOf(selection, all);
  if (!whole) return "";
  const words = new Map([...all].map(([at, text]) => [at, text.words] as const));
  if (!long) return selectedText(whole, words);
  const [start, end] = whole.anchor.page <= whole.focus.page ? [whole.anchor, whole.focus] : [whole.focus, whole.anchor];
  const head = selectedText({ anchor: start, focus: { page: from, index: Number.MAX_SAFE_INTEGER } }, words);
  const tail = selectedText({ anchor: { page: to, index: 0 }, focus: end }, words);
  const middle = await source.plainText(from + 1, to - 1);
  return [head, middle.trim(), tail].filter((part) => part !== "").join("\n\n");
}
