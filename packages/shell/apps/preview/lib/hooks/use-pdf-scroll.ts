/**
 * A PDF's zoom and scroll, as state: the zoom (to the width, to fit a page,
 * or a chosen scale), where the surface is scrolled (kept inside the document),
 * and the area it is drawn in. Keys and wheel turns can come several at once,
 * so the latest values live in a ref that each action reads and writes.
 */

import { useMemo, useRef, useState } from "react";
import type { Size } from "../dimensions.ts";
import { clampScroll, currentPage, type Layout, layoutPages, scrollToPage } from "../layout.ts";
import { type DocZoom, type PagePoint, PDF_UNIT, pagePointAt, type Scroll, scaleFor, scrollAfterZoom } from "../pdf/pdf-view.ts";
import type { PdfState } from "../snapshot.ts";
import { zoomIn, zoomOut } from "../zoom.ts";

export interface PdfScroll {
  zoom: DocZoom;
  scale: number;
  layout: Layout;
  /** The scroll, kept inside the document. */
  scroll: Scroll;
  area: Size;
  /** The page at the top of the screen's middle. */
  page: number;
  setArea(area: Size): void;
  scrollBy(dx: number, dy: number): void;
  scrollToTop(y: number): void;
  goToPage(page: number): void;
  zoomTo(zoom: DocZoom): void;
  stepZoom(direction: 1 | -1): void;
  /** The point under the surface's local position, on the page there, or null between pages. */
  pointAt(x: number, y: number): PagePoint | null;
  /** Back to the top, to the width: the start of a different file. */
  reset(): void;
}

export function usePdfScroll(pdf: PdfState | null, turns: number): PdfScroll {
  const sizes = pdf?.sizes ?? [];
  const [zoom, setZoom] = useState<DocZoom>({ kind: "width" });
  const [scroll, setScroll] = useState<Scroll>({ x: 0, y: 0 });
  const [area, setArea] = useState<Size>({ width: 0, height: 0 });

  const scale = scaleFor(zoom, sizes, area);
  const layout = useMemo(() => layoutPages(sizes, scale, area.width), [sizes, scale, area.width]);
  const held: Scroll = { x: clampScroll(scroll.x, layout.width, area.width), y: clampScroll(scroll.y, layout.height, area.height) };
  const page = currentPage(layout.boxes, held.y, area.height);

  // Keys and wheel turns can come several at once: each must see what the one before it did.
  const live = useRef({ scale, layout, scroll: held, area, sizes, page });
  live.current = { scale, layout, scroll: held, area, sizes, page };

  const zoomTo = (next: DocZoom): void => {
    const was = live.current;
    const to = scaleFor(next, was.sizes, was.area);
    const after = layoutPages(was.sizes, to, was.area.width);
    const settled = scrollAfterZoom(was, after);
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

  return {
    zoom,
    scale,
    layout,
    scroll: held,
    area,
    page,
    setArea: (next) => setArea((now) => (now.width === next.width && now.height === next.height ? now : next)),
    scrollBy: (dx, dy) => scrollTo(live.current.scroll.x + dx, live.current.scroll.y + dy),
    scrollToTop: (y) => scrollTo(live.current.scroll.x, y),
    goToPage: (target) => scrollTo(live.current.scroll.x, scrollToPage(live.current.layout.boxes, target)),
    zoomTo,
    stepZoom: (direction) => {
      const now = live.current.scale / PDF_UNIT;
      zoomTo({ kind: "scale", scale: (direction > 0 ? zoomIn(now) : zoomOut(now)) * PDF_UNIT });
    },
    pointAt: (x, y) => pagePointAt(x, y, live.current, turns),
    reset: () => {
      setZoom({ kind: "width" });
      setScroll({ x: 0, y: 0 });
    },
  };
}
