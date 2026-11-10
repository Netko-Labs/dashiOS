/**
 * A PDF page's words, for selecting and copying them: poppler's
 * `pdftotext -bbox-layout` gives every word with its box, in reading order,
 * grouped in lines and blocks. A selection runs from the word a drag started
 * on to the word under the pointer, across pages, as text is selected in a
 * reader. Pure: the surface maps the pointer to a page's points and draws the
 * boxes this returns.
 *
 * Boxes are in points from the page's top-left corner, as the page is shown
 * by poppler (its own /Rotate applied); `turnBox` applies Preview's rotation.
 */

import type { Size } from "./dimensions.ts";

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Word extends Box {
  text: string;
  /** Lines are numbered down the page; a new block starts a new paragraph. */
  line: number;
  block: number;
}

export interface PageText {
  /** The page's size in points, as poppler measured it. */
  width: number;
  height: number;
  words: Word[];
}

/** Words read from one page this long at most (a page of text has a few thousand). */
const MAX_WORDS = 20_000;

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return safeChar(Number.parseInt(name.slice(2), 16), whole);
    if (name.startsWith("#")) return safeChar(Number(name.slice(1)), whole);
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

const safeChar = (code: number, fallback: string): string => (Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : fallback);

function numberAttr(tag: string, name: string): number {
  const match = new RegExp(`\\b${name}="([-0-9.eE+]+)"`).exec(tag);
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * The first page of `pdftotext -bbox-layout` output (one page is asked for
 * at a time). Not a general XML reader: the tags poppler writes are all it
 * knows. Null when there is no page in it.
 */
export function parseBboxLayout(xhtml: string): PageText | null {
  const page = /<page\b[^>]*>/.exec(xhtml);
  if (!page) return null;
  const width = numberAttr(page[0], "width");
  const height = numberAttr(page[0], "height");
  if (!(width > 0) || !(height > 0)) return null;
  const words: Word[] = [];
  let line = -1;
  let block = -1;
  const tags = /<(block|line)\b[^>]*>|<word\b([^>]*)>([^<]*)<\/word>|<\/page>/g;
  for (let match = tags.exec(xhtml); match !== null && words.length < MAX_WORDS; match = tags.exec(xhtml)) {
    if (match[0] === "</page>") break;
    if (match[1] === "block") block++;
    else if (match[1] === "line") line++;
    else {
      const attrs = match[2] ?? "";
      const box = { x0: numberAttr(attrs, "xMin"), y0: numberAttr(attrs, "yMin"), x1: numberAttr(attrs, "xMax"), y1: numberAttr(attrs, "yMax") };
      const text = decode(match[3] ?? "");
      if (text !== "" && Object.values(box).every(Number.isFinite)) words.push({ ...box, text, line: Math.max(line, 0), block: Math.max(block, 0) });
    }
  }
  return { width, height, words };
}

/** A box on a page of `size` (points, unturned) after `turns` quarter turns clockwise. */
export function turnBox(box: Box, size: Size, turns: number): Box {
  switch (((Math.trunc(turns) % 4) + 4) % 4) {
    case 1:
      return { x0: size.height - box.y1, y0: box.x0, x1: size.height - box.y0, y1: box.x1 };
    case 2:
      return { x0: size.width - box.x1, y0: size.height - box.y1, x1: size.width - box.x0, y1: size.height - box.y0 };
    case 3:
      return { x0: box.y0, y0: size.width - box.x1, x1: box.y1, y1: size.width - box.x0 };
    default:
      return box;
  }
}

/** A point on the turned page back on the unturned one (the inverse of `turnBox` for a point). */
export function unturnPoint(x: number, y: number, size: Size, turns: number): { x: number; y: number } {
  switch (((Math.trunc(turns) % 4) + 4) % 4) {
    case 1:
      return { x: y, y: size.height - x };
    case 2:
      return { x: size.width - x, y: size.height - y };
    case 3:
      return { x: size.width - y, y: x };
    default:
      return { x, y };
  }
}

/** Where a word is in the document. */
export interface TextPoint {
  page: number;
  /** The word's index on its page; past the last word means the page's end. */
  index: number;
}

/** A drag's selection: where it started and where the pointer is now (either may come first). */
export interface TextRange {
  anchor: TextPoint;
  focus: TextPoint;
}

export const comparePoints = (a: TextPoint, b: TextPoint): number => a.page - b.page || a.index - b.index;

/** The range's ends in document order. */
export function ordered(range: TextRange): [TextPoint, TextPoint] {
  return comparePoints(range.anchor, range.focus) <= 0 ? [range.anchor, range.focus] : [range.focus, range.anchor];
}

/**
 * The word at a point (in the page's unturned points): the one under it,
 * else the nearest on the line the point is level with, else the nearest of
 * all. Null on a page with no words.
 */
export function wordAt(words: readonly Word[], x: number, y: number): number | null {
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const [index, word] of words.entries()) {
    const dx = x < word.x0 ? word.x0 - x : x > word.x1 ? x - word.x1 : 0;
    const dy = y < word.y0 ? word.y0 - y : y > word.y1 ? y - word.y1 : 0;
    // Level with a line, distance along it counts; off it, distance down the page counts far more.
    const score = dy * 1000 + dx;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  }
  return best;
}

/** The indexes of `page`'s words the range covers, both ends included, or null when it covers none of them. */
export function selectedOnPage(range: TextRange, page: number, count: number): [number, number] | null {
  const [start, end] = ordered(range);
  if (page < start.page || page > end.page || count === 0) return null;
  const from = page === start.page ? start.index : 0;
  const to = page === end.page ? Math.min(end.index, count - 1) : count - 1;
  return from <= to ? [from, to] : null;
}

/** The selection's text: words on a line joined by spaces, lines by line breaks, paragraphs and pages by a blank line. */
export function selectedText(range: TextRange, pages: ReadonlyMap<number, readonly Word[]>): string {
  const [start, end] = ordered(range);
  let out = "";
  let last: { word: Word; page: number } | null = null;
  for (let page = start.page; page <= end.page; page++) {
    const words = pages.get(page) ?? [];
    const span = selectedOnPage(range, page, words.length);
    if (!span) continue;
    for (let index = span[0]; index <= span[1]; index++) {
      const word = words[index] as Word;
      if (last !== null) out += page !== last.page || word.block !== last.word.block ? "\n\n" : word.line !== last.word.line ? "\n" : " ";
      out += word.text;
      last = { word, page };
    }
  }
  return out;
}

/** The selection on one page as boxes to draw: one per line, from its first selected word to its last. */
export function selectionBoxes(words: readonly Word[], span: [number, number]): Box[] {
  const boxes: Box[] = [];
  let current: (Box & { line: number }) | null = null;
  for (let index = span[0]; index <= span[1]; index++) {
    const word = words[index];
    if (!word) break;
    if (current && current.line === word.line) {
      current.x0 = Math.min(current.x0, word.x0);
      current.x1 = Math.max(current.x1, word.x1);
      current.y0 = Math.min(current.y0, word.y0);
      current.y1 = Math.max(current.y1, word.y1);
    } else {
      if (current) boxes.push({ x0: current.x0, y0: current.y0, x1: current.x1, y1: current.y1 });
      current = { x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1, line: word.line };
    }
  }
  if (current) boxes.push({ x0: current.x0, y0: current.y0, x1: current.x1, y1: current.y1 });
  return boxes;
}
