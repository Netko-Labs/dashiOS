/**
 * One row of the Terminal's grid: its runs of like-styled cells, in the
 * monospace face, in the colors the grid paints with (`Look`). A row redraws
 * only when its spans or the look change (`memo`), so the view keeps both
 * the same objects while nothing changes.
 */

import { Text, View } from "@mirinjs/metal";
import { memo } from "react";
import type { TerminalPalette } from "./palette.ts";
import type { Span } from "./screen.ts";

export const FONT_SIZE = 13;
export const LINE_HEIGHT = 18;

export interface Look {
  ground: string;
  ink: string;
  selection: string;
  cursor: string;
}

/** What the grid paints with: the terminal's own ground and ink (a program may have set them), else the palette's. */
export function lookFor(palette: TerminalPalette, dark: boolean, accent: string, fg: string | undefined, bg: string | undefined): Look {
  const ink = fg ?? palette.ink;
  return { ground: bg ?? palette.ground, ink, selection: `${accent}${dark ? "66" : "40"}`, cursor: `${ink}${dark ? "cc" : "b3"}` };
}

function color(value: string | undefined, look: Look, fallback: string): string {
  if (value === "fg") return look.ink;
  if (value === "bg") return look.ground;
  return value ?? fallback;
}

export const Line = memo(function Line({ spans, look }: { spans: Span[]; look: Look }) {
  return (
    <View style={{ flexDirection: "row", height: LINE_HEIGHT, flexShrink: 0, overflow: "hidden" }}>
      {spans.map((span, index) => {
        const background = span.sel ? look.selection : span.bg ? color(span.bg, look, look.ground) : undefined;
        return (
          <View key={index} style={background ? { backgroundColor: background, flexShrink: 0 } : { flexShrink: 0 }}>
            <Text
              style={{
                fontFamily: "monospace",
                fontSize: FONT_SIZE,
                lineHeight: LINE_HEIGHT,
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
        );
      })}
    </View>
  );
});
