/**
 * How a PDF is looked at: the zoom (to the width, to fit a page, or a chosen
 * scale), where the surface is scrolled to, and the text a drag selected.
 * The surface (surface.tsx) draws from this and the window's keys and menus
 * act through it. Pages near the screen are asked of the viewer as the
 * scroll and the zoom settle, the nearest first.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { Size } from "./dimensions.ts";
import {
  anchorAt,
  anchorY,
  clampScroll,
  currentPage,
  fitPageScale,
  fitWidthScale,
  type Layout,
  layoutPages,
  MARGIN,
  OVERSCAN,
  scrollToPage,
  visiblePages,
} from "./layout.ts";
import type { PdfState } from "./snapshot.ts";
import { type PageText, selectedText, type TextPoint, type TextRange, unturnPoint, wordAt } from "./text.ts";
import type { Viewer } from "./viewer.ts";
import { clampScale, turned, zoomIn, zoomOut } from "./zoom.ts";

/** A PDF's "100%" is the screen's 96 dpi: a point is 4/3 of a logical pixel. */
export const PDF_UNIT = 96 / 72;
/** One wheel line, in logical pixels; an arrow key scrolls two. */
export const LINE_PX = 24;
/** How long the scroll and the zoom are still before pages are asked for. */
const SETTLE_MS = 90;
/** A copy across more pages than this reads the pages between its ends as plain text. */
const LONG_RUN = 8;

export type DocZoom = { kind: "width" } | { kind: "fit" } | { kind: "scale"; scale: number };

export interface Scroll {
  x: number;
  y: number;
}

/** A point on a page, in its points as poppler measures it (before Preview's rotation). */
export interface PagePoint {
  page: number;
  x: number;
  y: number;
}

export interface Selection {
  anchor: PagePoint;
  focus: PagePoint;
}

/** The scale a zoom stands for in an area. */
export function scaleFor(zoom: DocZoom, sizes: readonly Size[], area: Size): number {
  if (zoom.kind === "width") return clampScale(fitWidthScale(sizes, area.width));
  if (zoom.kind === "fit") return clampScale(fitPageScale(sizes, area));
  return clampScale(zoom.scale);
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

/** The pages to ask for, nearest the current one first. */
export function byDistance(pages: readonly number[], from: number): number[] {
  return [...pages].sort((a, b) => Math.abs(a - from) - Math.abs(b - from) || a - b);
}

export interface DocumentView {
  zoom: DocZoom;
  scale: number;
  layout: Layout;
  scroll: Scroll;
  area: Size;
  page: number;
  selection: Selection | null;
  range: TextRange | null;
  setArea(area: Size): void;
  scrollBy(dx: number, dy: number): void;
  scrollToTop(y: number): void;
  goToPage(page: number): void;
  zoomTo(zoom: DocZoom): void;
  stepZoom(direction: 1 | -1): void;
  select(selection: Selection | null): void;
  /** The strip's rows on screen, for their thumbnails. */
  setStripPages(pages: readonly number[]): void;
  /** The point under the surface's local position, on the page there, or null between pages. */
  pointAt(x: number, y: number): PagePoint | null;
  /** The selected text, reading pages not read yet. */
  copyText(): Promise<string>;
  selectAll(): void;
}

export function useDocument(viewer: Viewer, pdf: PdfState | null, turns: number, path: string | null): DocumentView {
  const sizes = pdf?.sizes ?? [];
  const [zoom, setZoom] = useState<DocZoom>({ kind: "width" });
  const [scroll, setScroll] = useState<Scroll>({ x: 0, y: 0 });
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });
  const [selection, setSelection] = useState<Selection | null>(null);
  const [stripPages, setStripPages] = useState<readonly number[]>([]);

  const scale = scaleFor(zoom, sizes, area);
  const layout = useMemo(() => layoutPages(sizes, scale, area.width), [sizes, scale, area.width]);
  const held: Scroll = { x: clampScroll(scroll.x, layout.width, area.width), y: clampScroll(scroll.y, layout.height, area.height) };
  const page = currentPage(layout.boxes, held.y, area.height);

  // A different file starts at its top, to the width, with nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different file resets the view
  useEffect(() => {
    setZoom({ kind: "width" });
    setScroll({ x: 0, y: 0 });
    setSelection(null);
  }, [path]);

  // Keys and wheel turns can come several at once: each must see what the one before it did.
  const live = useRef({ scale, layout, scroll: held, area, sizes, page });
  live.current = { scale, layout, scroll: held, area, sizes, page };

  // Ask for the pages near the screen once the scroll and the zoom settle.
  const near = byDistance(visiblePages(layout.boxes, held.y, area.height, OVERSCAN), page);
  const wantKey = `${near.join(",")}|${scale.toFixed(4)}|${stripPages.join(",")}|${turns}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key says everything the request depends on
  useEffect(() => {
    if (!pdf || area.width === 0) return undefined;
    const timer = setTimeout(() => viewer.wantPages(near, scale, stripPages), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [wantKey, viewer, pdf !== null, area.width]);

  const zoomTo = (next: DocZoom): void => {
    const was = live.current;
    const to = scaleFor(next, was.sizes, was.area);
    const after = layoutPages(was.sizes, to, was.area.width);
    // The point in the middle of the screen stays there.
    const anchor = anchorAt(was.layout.boxes, was.scroll.y + was.area.height / 2);
    const y = anchorY(after.boxes, anchor) - was.area.height / 2;
    const x = was.layout.width > 0 ? ((was.scroll.x + was.area.width / 2) * after.width) / was.layout.width - was.area.width / 2 : 0;
    const settled = { x: clampScroll(x, after.width, was.area.width), y: clampScroll(y, after.height, was.area.height) };
    live.current = { ...was, scale: to, layout: after, scroll: settled };
    setZoom(next);
    setScroll(settled);
  };

  const scrollTo = (x: number, y: number): void => {
    const was = live.current;
    const settled = { x: clampScroll(x, was.layout.width, was.area.width), y: clampScroll(y, was.layout.height, was.area.height) };
    live.current = { ...was, scroll: settled };
    setScroll(settled);
  };

  const texts = pdf?.texts ?? new Map<number, PageText>();
  const range = selection ? rangeOf(selection, texts) : null;

  return {
    zoom,
    scale,
    layout,
    scroll: held,
    area,
    page,
    selection,
    range,
    setArea,
    scrollBy: (dx, dy) => scrollTo(live.current.scroll.x + dx, live.current.scroll.y + dy),
    scrollToTop: (y) => scrollTo(live.current.scroll.x, y),
    goToPage: (target) => scrollTo(live.current.scroll.x, scrollToPage(live.current.layout.boxes, target)),
    zoomTo,
    stepZoom: (direction) => {
      const now = live.current.scale / PDF_UNIT;
      zoomTo({ kind: "scale", scale: (direction > 0 ? zoomIn(now) : zoomOut(now)) * PDF_UNIT });
    },
    select: (next) => {
      setSelection(next);
      if (next) {
        viewer.wantText(next.anchor.page);
        if (next.focus.page !== next.anchor.page) viewer.wantText(next.focus.page);
      }
    },
    setStripPages: (pages) => setStripPages((now) => (now.join(",") === pages.join(",") ? now : pages)),
    pointAt: (x, y) => {
      const was = live.current;
      const cx = x + was.scroll.x;
      const cy = y + was.scroll.y;
      const box = was.layout.boxes.find((each) => cy >= each.top - MARGIN / 2 && cy <= each.top + each.height + MARGIN / 2);
      if (!box) return null;
      const shown = was.sizes[box.page - 1];
      if (!shown) return null;
      const px = Math.min(Math.max((cx - box.left) / was.scale, 0), shown.width);
      const py = Math.min(Math.max((cy - box.top) / was.scale, 0), shown.height);
      // Back through Preview's rotation, onto the page as poppler measures it.
      const plain = turned(shown, turns);
      const point = unturnPoint(px, py, plain, turns);
      return { page: box.page, x: point.x, y: point.y };
    },
    copyText: async () => {
      if (!selection || !pdf) return "";
      const from = Math.min(selection.anchor.page, selection.focus.page);
      const to = Math.max(selection.anchor.page, selection.focus.page);
      // The first and last pages word by word (a selection starts and ends mid-page); a long run between them as plain text, in one read.
      const long = to - from > LONG_RUN;
      const all = await viewer.textOf(long ? [from, to] : Array.from({ length: to - from + 1 }, (_, index) => from + index));
      const whole = rangeOf(selection, all);
      if (!whole) return "";
      const words = new Map([...all].map(([at, text]) => [at, text.words] as const));
      if (!long) return selectedText(whole, words);
      const [start, end] = whole.anchor.page <= whole.focus.page ? [whole.anchor, whole.focus] : [whole.focus, whole.anchor];
      const head = selectedText({ anchor: start, focus: { page: from, index: Number.MAX_SAFE_INTEGER } }, words);
      const tail = selectedText({ anchor: { page: to, index: 0 }, focus: end }, words);
      const middle = await viewer.plainText(from + 1, to - 1);
      return [head, middle.trim(), tail].filter((part) => part !== "").join("\n\n");
    },
    selectAll: () => {
      if (!pdf) return;
      const last = pdf.sizes[pdf.sizes.length - 1] ?? { width: 0, height: 0 };
      const end = turned(last, turns);
      setSelection({ anchor: { page: 1, x: 0, y: 0 }, focus: { page: pdf.pages, x: end.width, y: end.height } });
      viewer.wantText(1);
      viewer.wantText(pdf.pages);
    },
  };
}
