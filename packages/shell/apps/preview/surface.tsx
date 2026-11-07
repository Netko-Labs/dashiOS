/**
 * A PDF on screen: its pages stacked in one surface that scrolls with the
 * wheel and the touchpad (both ways once a page is wider than the window),
 * only the pages near the screen drawn, each a quiet card until its render
 * arrives. A drag across the text selects it, as in a reader; the bar at the
 * right edge shows where you are and drags too. Metal has no scroll offset
 * to set, so the scroll is ours: the pages sit in absolutely placed boxes
 * inside a clipped view (document.ts does the arithmetic).
 */

import { useColors, useSurface } from "@dashi/ui";
import { Image, View } from "@mirinjs/metal";
import { useRef } from "react";
import { type DocumentView, LINE_PX, type PagePoint } from "./document.ts";
import { visiblePages } from "./layout.ts";
import type { PdfState } from "./snapshot.ts";
import { selectedOnPage, selectionBoxes, turnBox } from "./text.ts";
import { turned } from "./zoom.ts";

/** The scroll bar: its width, its least length, and how far it sits from the edge. */
const BAR = { width: 7, least: 28, inset: 3 } as const;
/** A drag that moved less than this is a click (it lets go of the selection). */
const CLICK_SLOP = 3;

export function DocumentSurface({ pdf, doc, turns, ground }: { pdf: PdfState; doc: DocumentView; turns: number; ground: string }) {
  const colors = useColors();
  const surface = useSurface();
  const { layout, scroll, area, scale } = doc;
  const drag = useRef<{ x: number; y: number; anchor: PagePoint | null; moved: boolean } | null>(null);
  const bar = useRef<{ y: number; scroll: number } | null>(null);

  const shown = visiblePages(layout.boxes, scroll.y, area.height, 0.25);
  const range = doc.range;

  // The bar: as long as the screen is a share of the document, as far down as the scroll is.
  const track = Math.max(0, area.height - BAR.inset * 2);
  const barLength = layout.height > area.height ? Math.max(BAR.least, (track * area.height) / layout.height) : 0;
  const barTop = barLength > 0 ? BAR.inset + ((track - barLength) * scroll.y) / Math.max(1, layout.height - area.height) : 0;

  return (
    <View
      testID="document"
      onLayout={(bounds) => doc.setArea({ width: bounds.width, height: bounds.height })}
      onWheel={(wheel) => doc.scrollBy(-wheel.dx * LINE_PX, -wheel.dy * LINE_PX)}
      onPointer={(event) => {
        const x = event.x - (event.bounds?.x ?? 0);
        const y = event.y - (event.bounds?.y ?? 0);
        if (event.phase === "down") {
          const anchor = doc.pointAt(x, y);
          drag.current = { x, y, anchor, moved: false };
        } else if (event.phase === "move" && drag.current) {
          const start = drag.current;
          if (!start.moved && Math.hypot(x - start.x, y - start.y) < CLICK_SLOP) return;
          start.moved = true;
          // Past the top or the bottom, the surface scrolls on under the drag.
          if (y < 0) doc.scrollBy(0, Math.max(y, -LINE_PX * 2));
          else if (y > area.height) doc.scrollBy(0, Math.min(y - area.height, LINE_PX * 2));
          const focus = doc.pointAt(x, Math.min(Math.max(y, 0), area.height));
          if (start.anchor && focus) doc.select({ anchor: start.anchor, focus });
        } else if (event.phase === "up") {
          if (drag.current && !drag.current.moved) doc.select(null);
          drag.current = null;
        }
      }}
      style={{ flex: 1, position: "relative", overflow: "hidden", backgroundColor: ground }}
    >
      {shown.map((page) => {
        const box = layout.boxes[page - 1];
        if (!box) return null;
        const render = pdf.renders.get(page);
        const words = pdf.texts.get(page);
        const span = range && words ? selectedOnPage(range, page, words.words.length) : null;
        const plain = turned(pdf.sizes[page - 1] ?? { width: box.width, height: box.height }, turns);
        return (
          <View
            key={page}
            testID={`page:${page}`}
            style={{
              position: "absolute",
              left: box.left - scroll.x,
              top: box.top - scroll.y,
              width: box.width,
              height: box.height,
              // Paper before the page is drawn: the card ground with a hairline, quiet in both modes. The drawn
              // page fills the box whole, so the hairline goes with the paper (a border would inset the picture).
              backgroundColor: surface.card,
              ...(render ? {} : { borderWidth: 1, borderColor: colors.separator }),
            }}
          >
            {render && <Image source={render.source} resizeMode="contain" style={{ width: box.width, height: box.height }} />}
            {span &&
              words &&
              selectionBoxes(words.words, span).map((each, index) => {
                const turnedBox = turnBox(each, plain, turns);
                return (
                  <View
                    // One box per selected line, in order: redrawn whole as the selection changes.
                    key={index}
                    testID={`selection:${page}:${index}`}
                    style={{
                      position: "absolute",
                      left: turnedBox.x0 * scale,
                      top: turnedBox.y0 * scale,
                      width: Math.max(1, (turnedBox.x1 - turnedBox.x0) * scale),
                      height: Math.max(1, (turnedBox.y1 - turnedBox.y0) * scale),
                      backgroundColor: colors.textSelection,
                    }}
                  />
                );
              })}
          </View>
        );
      })}
      {barLength > 0 && (
        <View
          testID="document:bar"
          onPointer={(event) => {
            if (event.phase === "down") bar.current = { y: event.y, scroll: scroll.y };
            else if (event.phase === "move" && bar.current) {
              const per = (layout.height - area.height) / Math.max(1, track - barLength);
              doc.scrollToTop(bar.current.scroll + (event.y - bar.current.y) * per);
            } else if (event.phase === "up") bar.current = null;
          }}
          style={{
            position: "absolute",
            right: BAR.inset,
            top: barTop,
            width: BAR.width,
            height: barLength,
            borderRadius: BAR.width / 2,
            backgroundColor: colors.track,
            hoverBackgroundColor: colors.pressed,
          }}
        />
      )}
    </View>
  );
}
