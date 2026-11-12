/**
 * A row of a Settings card (docs/design.html, "Settings"): 56 tall, its
 * glyph on a round 40 knob (a row without one starts with its words), its
 * name 13.5 SemiBold and a quieter line under it, then its control at the
 * end, or under the words (`stack`) when the control needs the width. A
 * control can also sit at the end with a second part under the words
 * (`below`: the charge limit's switch, and its slider while it is on).
 */

import { Text, View } from "@mirinjs/metal";
import { type ReactNode, useContext, useLayoutEffect, useRef, useState } from "react";
import { CARD_RADIUS, CardRowsContext } from "../../shared/cards/index.ts";
import { type PillsLaid, PillsWrapped } from "../../shared/controls/inputs.tsx";
import { useControlColors } from "../../shared/controls/palette.ts";
import { Knob } from "../../shared/controls/parts.tsx";

/** Tell the card this row is in whether it starts with a knob (edge.ts: one left edge per card). */
export function useCardRow(knob: boolean): void {
  const card = useContext(CardRowsContext);
  const token = useRef(Symbol("row"));
  useLayoutEffect(() => card?.report(token.current, knob), [card, knob]);
}

/**
 * The page's measures: the title row, the side margins, a card's corners, a
 * row's height and knob, a row's inset at both ends (its knob's, at the left), and the least width a row's words keep beside its
 * control (in a narrow window the control's pills wrap first, so the words
 * never break letter by letter).
 */
export const PAGE = { title: 56, margin: 22, cardRadius: CARD_RADIUS, heroRadius: 28, row: 56, knob: 40, words: 120, inset: 16, knobInset: 8 } as const;

export interface RowProps {
  label: string;
  detail?: string;
  /** The glyph on the row's knob; a row without one starts with its words. */
  glyph?: string;
  children?: ReactNode;
  /** The control under the words, not beside them. */
  stack?: boolean;
  /** A second part under the words, in line with them, while the control stays at the end. */
  below?: ReactNode;
  testID?: string;
}

/**
 * Whether a row's pills go under its words: when the room beside the words
 * (`room`) is less than the pills' width on one line (`natural`, once
 * known). Pure.
 */
export function pillsUnder(room: number, natural: number | null): boolean {
  return natural !== null && room < natural;
}

/** The room a row `width` wide leaves its control beside the words: its insets, the knob and its gap, the words' least width and the gap after them. */
export function roomBeside(width: number, knob: boolean): number {
  const inset = (knob ? PAGE.knobInset + PAGE.knob + 12 : PAGE.inset) + PAGE.inset;
  return width - inset - PAGE.words - 12;
}

/**
 * Pills that wrap beside a row's words go under them instead, so a narrow
 * window never shows a pill alone on a second line. The row learns the
 * pills' one-line width from the pills themselves (`PillsWrapped`): laid on
 * one line, their width; wrapped, more than the width they were squeezed to.
 * It compares that with the room its own width leaves, so the choice never
 * depends on which layout event came first: the pills' comes before their
 * row's (mirin reports a parent's children after laying them out), and a
 * wrap paired with the row's last width remembered a wider window's width,
 * keeping the pills under at full screen.
 */
function useWrapFit(knob: boolean): { under: boolean; onWidth: (width: number) => void; report: (laid: PillsLaid) => void } {
  const [width, setWidth] = useState(0);
  const [natural, setNatural] = useState<number | null>(null);
  const under = width > 0 && pillsUnder(roomBeside(width, knob), natural);
  return {
    under,
    onWidth: (laid) => setWidth(Math.round(laid)),
    report: ({ wrapped, width: pills }) => {
      const wide = Math.ceil(pills);
      setNatural((known) => (wrapped ? Math.max(known ?? 0, wide + 1) : wide));
    },
  };
}

/**
 * Whether a row's first line holds its words and nothing else: a stacked
 * row without a knob. That line is then as tall as the words, so the
 * control under them sits one gap below (a one-line title kept the full
 * line's height, and left a blank band under itself: "For").
 */
export function wordsOnly(stack: boolean, knob: boolean): boolean {
  return stack && !knob;
}

/** A row: its knob, its name and a quieter line under it, then the control at the end (or under, `stack`). */
export function Row({ label, detail, glyph, children, stack: asked, below, testID }: RowProps) {
  const colors = useControlColors();
  useCardRow(glyph !== undefined);
  const fit = useWrapFit(glyph !== undefined);
  const stack = asked === true || fit.under;
  const words = (
    <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: PAGE.words }}>
      <Text style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>{label}</Text>
      {detail !== undefined && detail !== "" && <Text style={{ fontSize: 11.5, color: colors.muted }}>{detail}</Text>}
    </View>
  );
  const knob = glyph !== undefined ? <Knob glyph={glyph} size={PAGE.knob} /> : null;
  const top = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, ...(wordsOnly(stack, glyph !== undefined) ? {} : { minHeight: PAGE.row - 16 }) }}>
      {knob}
      {words}
      {!stack && <PillsWrapped.Provider value={fit.report}>{children}</PillsWrapped.Provider>}
    </View>
  );
  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      onLayout={(laid) => fit.onWidth(laid.width)}
      style={{
        minHeight: PAGE.row,
        flexDirection: "column",
        justifyContent: "center",
        gap: 10,
        paddingTop: 8,
        paddingBottom: stack || below ? 12 : 8,
        paddingLeft: glyph !== undefined ? PAGE.knobInset : PAGE.inset,
        paddingRight: PAGE.inset,
      }}
    >
      {top}
      {stack && children !== undefined && children !== null && children !== false && (
        <View style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, paddingLeft: glyph !== undefined ? PAGE.knob + 12 : 0 }}>
          {/* Under the words, the pills still tell their one-line width, so the row knows when they fit beside again. */}
          {asked === true ? children : <PillsWrapped.Provider value={fit.report}>{children}</PillsWrapped.Provider>}
        </View>
      )}
      {below !== undefined && below !== null && below !== false && (
        <View style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, paddingLeft: glyph !== undefined ? PAGE.knob + 12 : 0 }}>{below}</View>
      )}
    </View>
  );
}
