/**
 * How a PDF is looked at, as one view for the window: the zoom, where the
 * surface is scrolled, and the selection (use-pdf-scroll.ts, use-pdf-selection.ts).
 * The surface (surface.tsx) draws from this and the window's keys and menus
 * act through it. Pages near the screen are asked of the viewer as the
 * scroll and the zoom settle, the nearest first.
 */

import { useEffect, useState } from "react";
import type { Size } from "./dimensions.ts";
import { usePdfScroll } from "./hooks/use-pdf-scroll.ts";
import { usePdfSelection } from "./hooks/use-pdf-selection.ts";
import { type Layout, OVERSCAN, visiblePages } from "./layout.ts";
import { rangeOf, type Selection } from "./pdf/pdf-selection.ts";
import type { DocZoom, PagePoint, Scroll } from "./pdf/pdf-view.ts";
import type { PdfState } from "./snapshot.ts";
import type { PageText, TextRange } from "./text.ts";
import type { Viewer } from "./viewer.ts";

/** One wheel line, in logical pixels; an arrow key scrolls two. */
export const LINE_PX = 24;
/** How long the scroll and the zoom are still before pages are asked for. */
const SETTLE_MS = 90;

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
  /** Whether text is selected, as of the latest select (before the window draws it: ❖A then ❖C at once). */
  hasSelection(): boolean;
  /** The selected text, reading pages not read yet. */
  copyText(): Promise<string>;
  selectAll(): void;
}

export function useDocument(viewer: Viewer, pdf: PdfState | null, turns: number, path: string | null): DocumentView {
  const view = usePdfScroll(pdf, turns);
  const picked = usePdfSelection(viewer, pdf, turns);
  const { layout, scroll, area, scale, page } = view;
  const [stripPages, setStripPages] = useState<readonly number[]>([]);

  // A different file starts at its top, to the width, with nothing selected.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different file resets the view
  useEffect(() => {
    view.reset();
    picked.clear();
  }, [path]);

  // Ask for the pages near the screen once the scroll and the zoom settle.
  const near = byDistance(visiblePages(layout.boxes, scroll.y, area.height, OVERSCAN), page);
  const wantKey = `${near.join(",")}|${scale.toFixed(4)}|${stripPages.join(",")}|${turns}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key says everything the request depends on
  useEffect(() => {
    if (!pdf || area.width === 0) return undefined;
    const timer = setTimeout(() => viewer.wantPages(near, scale, stripPages), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [wantKey, viewer, pdf !== null, area.width]);

  const texts = pdf?.texts ?? new Map<number, PageText>();
  const selection = picked.selection;
  const range = selection ? rangeOf(selection, texts) : null;
  // A selection over pages on screen whose words aren't read yet (Select All, a long drag): read them, so it is drawn there too.
  const from = selection ? Math.min(selection.anchor.page, selection.focus.page) : 0;
  const to = selection ? Math.max(selection.anchor.page, selection.focus.page) : -1;
  const unread = visiblePages(layout.boxes, scroll.y, area.height).filter((each) => each >= from && each <= to && !texts.has(each));
  const unreadKey = unread.join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the list
  useEffect(() => {
    for (const each of unread) viewer.wantText(each);
  }, [unreadKey, viewer]);

  return {
    zoom: view.zoom,
    scale,
    layout,
    scroll,
    area,
    page,
    selection,
    range,
    setArea: view.setArea,
    scrollBy: view.scrollBy,
    scrollToTop: view.scrollToTop,
    goToPage: view.goToPage,
    zoomTo: view.zoomTo,
    stepZoom: view.stepZoom,
    select: picked.select,
    setStripPages: (pages) => setStripPages((now) => (now.join(",") === pages.join(",") ? now : pages)),
    pointAt: view.pointAt,
    hasSelection: picked.hasSelection,
    copyText: picked.copyText,
    selectAll: picked.selectAll,
  };
}
