/**
 * A selection on a PDF: the two ends of a drag (points on pages, as poppler
 * measures them), and the word range they cover once the pages' words are read.
 */

import { type PageText, type TextPoint, type TextRange, wordAt } from "../text.ts";
import type { PagePoint } from "./pdf-view.ts";

export interface Selection {
  anchor: PagePoint;
  focus: PagePoint;
}

/** The word range a selection covers, once both its pages' words are read; null before, or on a page with none. */
export function rangeOf(selection: Selection, texts: ReadonlyMap<number, PageText>): TextRange | null {
  const point = (at: PagePoint): TextPoint | null => {
    const words = texts.get(at.page)?.words;
    if (!words) return null;
    const index = wordAt(words, at.x, at.y);
    return index === null ? null : { page: at.page, index };
  };
  const anchor = point(selection.anchor);
  const focus = point(selection.focus);
  return anchor && focus ? { anchor, focus } : null;
}
