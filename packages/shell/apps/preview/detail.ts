/**
 * The quiet words in Preview's toolbar row: an image's size and its place in
 * the folder ("320 × 180 · 3 of 12"), or a PDF's pages and title. A narrow
 * window never cuts the size ("320 × 18…"): the less important words go
 * first, and what is shown is always whole. Pure: the view measures the room
 * and picks the longest choice that fits.
 */

import type { Size } from "./dimensions.ts";

/** A few pixels kept free, so an estimate a little short still fits. */
const SLACK = 4;

/** The toolbar's detail is 11 px. */
export const DETAIL_SIZE = 11;

/**
 * About how wide `text` is at `size` px: a little wider than the UI font's
 * real advances, so what is chosen fits rather than being cut by a pixel.
 */
export function textWidth(text: string, size: number = DETAIL_SIZE): number {
  let ems = 0;
  for (const char of text) ems += char === " " ? 0.3 : /[.,:;'’|il1]/.test(char) ? 0.35 : /[MW×]/.test(char) ? 0.9 : 0.62;
  return ems * size;
}

export interface DetailFacts {
  /** The picture's size as it is shown (turned), when known. */
  size: Size | null;
  /** Its place among the folder's pictures, when there are several. */
  folder: { index: number; count: number } | null;
  pdf: { pages: number; title: string | null } | null;
}

/** What may be said, the fullest first, each a shorter one than the last; the last always says the most important thing. */
export function detailChoices({ size, folder, pdf }: DetailFacts): string[] {
  if (pdf) {
    const pages = `${pdf.pages} ${pdf.pages === 1 ? "page" : "pages"}`;
    return pdf.title ? [`${pages} · ${pdf.title}`, pages] : [pages];
  }
  const dimensions = size ? `${size.width} × ${size.height}` : null;
  const place = folder && folder.index >= 0 && folder.count > 1 ? `${folder.index + 1} of ${folder.count}` : null;
  if (dimensions && place) return [`${dimensions} · ${place}`, dimensions];
  return [dimensions ?? place].filter((choice): choice is string => choice !== null);
}

/** The fullest choice that fits in `room` px, or null when none does (the words go, never half of them). */
export function fitDetail(choices: readonly string[], room: number): string | null {
  return choices.find((choice) => textWidth(choice) + SLACK <= room) ?? null;
}
