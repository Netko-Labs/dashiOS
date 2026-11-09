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
import { PillsWrapped } from "../shared/controls/inputs.tsx";
import { useControlColors } from "../shared/controls/palette.ts";
import { Knob } from "../shared/controls/parts.tsx";
import { CardRowsContext } from "./edge.ts";

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
export const PAGE = { title: 56, margin: 22, cardRadius: 24, heroRadius: 28, row: 56, knob: 40, words: 120, inset: 16, knobInset: 8 } as const;

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
 * Whether a row's pills go under its words: once they wrapped beside them
 * at some width (`wrappedAt`), at that width and under; past it they are
 * tried beside the words again. Pure.
 */
export function pillsUnder(width: number, wrappedAt: number | null): boolean {
  return wrappedAt !== null && width <= wrappedAt;
}

/**
 * Pills that wrap beside a row's words go under them instead: the row
 * hears it from the pills (`PillsWrapped`) and remembers the width it
 * happened at, so a narrow window never shows a pill alone on a second line.
 */
function useWrapFit(): { under: boolean; onWidth: (width: number) => void; report: (wrapped: boolean) => void } {
  const [width, setWidth] = useState(0);
  const [wrappedAt, setWrappedAt] = useState<number | null>(null);
  const under = pillsUnder(width, wrappedAt);
  const latest = useRef({ width, under });
  latest.current = { width, under };
  // Pills can be laid out before the row has told its width: the wrap waits for it.
  const pending = useRef(false);
  return {
    under,
    onWidth: (laid) => {
      const rounded = Math.round(laid);
      if (rounded === latest.current.width) return;
      setWidth(rounded);
      if (pending.current) {
        pending.current = false;
        setWrappedAt(rounded);
      }
    },
    report: (wrapped) => {
      const now = latest.current;
      pending.current = wrapped && now.width === 0;
      if (wrapped && !now.under && now.width > 0) setWrappedAt(now.width);
    },
  };
}

/** A row: its knob, its name and a quieter line under it, then the control at the end (or under, `stack`). */
export function Row({ label, detail, glyph, children, stack: asked, below, testID }: RowProps) {
  const colors = useControlColors();
  useCardRow(glyph !== undefined);
  const fit = useWrapFit();
  const stack = asked === true || fit.under;
  const words = (
    <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: PAGE.words }}>
      <Text style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>{label}</Text>
      {detail !== undefined && detail !== "" && <Text style={{ fontSize: 11.5, color: colors.muted }}>{detail}</Text>}
    </View>
  );
  const knob = glyph !== undefined ? <Knob glyph={glyph} size={PAGE.knob} /> : null;
  const top = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: PAGE.row - 16 }}>
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
        <View style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, paddingLeft: glyph !== undefined ? PAGE.knob + 12 : 0 }}>{children}</View>
      )}
      {below !== undefined && below !== null && below !== false && (
        <View style={{ flexDirection: "column", alignItems: "flex-start", gap: 8, paddingLeft: glyph !== undefined ? PAGE.knob + 12 : 0 }}>{below}</View>
      )}
    </View>
  );
}
