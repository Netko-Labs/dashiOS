/**
 * One row of the Terminal's grid, in the monospace face, in the colors the
 * grid paints with (`Look`). Each span is pinned to its columns (`x`, `w`
 * cells of `cell` px): a glyph wider or narrower than its cells (an emoji, a
 * CJK character, an icon from a fallback face) is clipped or centered in
 * them and never moves the rest of the row, so the cursor, the selection and
 * the pointer land on the same cells as the text (VS-4's grid, roast #2).
 * A row redraws only when its spans, the look or the cell change (`memo`).
 */

import { Text, View } from "@mirinjs/metal";
import { memo } from "react";
import type { TerminalPalette } from "./palette.ts";
import type { Span } from "./screen.ts";

export const FONT_SIZE = 13;
export const LINE_HEIGHT = 18;
/** ❖+ and ❖− step the face through these sizes; ❖0 goes back to FONT_SIZE. */
export const FONT_SIZES = [9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32] as const;

/** The row height for a face size: 18 at 13, in step. */
export function lineHeightFor(fontSize: number): number {
  return Math.round((fontSize * LINE_HEIGHT) / FONT_SIZE);
}

/** The next size up (1) or down (−1) from `size`, staying at the ends. */
export function stepFontSize(size: number, delta: 1 | -1): number {
  const at = FONT_SIZES.findIndex((each) => each >= size);
  const index = at < 0 ? FONT_SIZES.length - 1 : at;
  const next = FONT_SIZES[Math.min(Math.max(index + delta, 0), FONT_SIZES.length - 1)];
  return next ?? size;
}

export interface Look {
  ground: string;
  ink: string;
  selection: string;
  cursor: string;
}

/** What the grid paints with: the terminal's own ground and ink (a program may have set them), else the palette's; the selection washed in the accent, the cursor in the palette's kombu. */
export function lookFor(palette: TerminalPalette, dark: boolean, accent: string, ownInk: string | undefined, ownGround: string | undefined): Look {
  const ink = ownInk ?? palette.ink;
  return { ground: ownGround ?? palette.ground, ink, selection: `${accent}${dark ? "66" : "40"}`, cursor: palette.cursor };
}

export function color(value: string | undefined, look: Look, fallback: string): string {
  if (value === "fg") return look.ink;
  if (value === "bg") return look.ground;
  return value ?? fallback;
}

export interface Cell {
  width: number;
  height: number;
  fontSize: number;
}

export const Line = memo(function Line({ spans, look, cell }: { spans: Span[]; look: Look; cell: Cell }) {
  return (
    <View style={{ height: cell.height, flexShrink: 0, position: "relative" }}>
      {spans.map((span) => {
        const background = span.sel ? look.selection : span.bg ? color(span.bg, look, look.ground) : undefined;
        // A lone character (wide, or from another face) sits centered in its cells; a run starts at its first.
        const lone = Array.from(span.s).length === 1;
        return (
          <View
            key={span.x}
            style={{
              position: "absolute",
              left: span.x * cell.width,
              top: 0,
              width: span.w * cell.width,
              height: cell.height,
              overflow: "hidden",
              flexDirection: "row",
              justifyContent: lone ? "center" : "flex-start",
              ...(background ? { backgroundColor: background } : {}),
            }}
          >
            {/* Wider than its cells, so a run never wraps if the face's advance is a hair over the cell's. */}
            <View style={{ flexShrink: 0, width: (span.w + 2) * cell.width, ...(lone ? { alignItems: "center" } : {}) }}>
              <Text
                style={{
                  fontFamily: "monospace",
                  fontSize: cell.fontSize,
                  lineHeight: cell.height,
                  color: color(span.fg, look, look.ink),
                  fontWeight: span.b ? "bold" : "normal",
                  fontStyle: span.i ? "italic" : "normal",
                  textDecorationLine: span.u ? "underline" : span.st ? "line-through" : "none",
                  opacity: span.dim ? 0.6 : 1,
                }}
              >
                {span.s}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
});
