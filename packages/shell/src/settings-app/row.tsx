/**
 * A row of a Settings card (docs/design.html, "Settings"): 56 tall, its
 * glyph on a round 40 knob (a row without one starts with its words), its
 * name 13.5 SemiBold and a quieter line under it, then its control at the
 * end, or under the words (`stack`) when the control needs the width. A
 * control can also sit at the end with a second part under the words
 * (`below`: the charge limit's switch, and its slider while it is on).
 */

import { Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useControlColors } from "../shared/controls/palette.ts";
import { Knob } from "../shared/controls/parts.tsx";

/** The page's measures: the title row, the side margins, a card's corners, a row's height and knob. */
export const PAGE = { title: 56, margin: 22, cardRadius: 24, heroRadius: 28, row: 56, knob: 40 } as const;

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

/** A row: its knob, its name and a quieter line under it, then the control at the end (or under, `stack`). */
export function Row({ label, detail, glyph, children, stack, below, testID }: RowProps) {
  const colors = useControlColors();
  const words = (
    <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 13.5, fontWeight: "semibold", color: colors.offInk }}>{label}</Text>
      {detail !== undefined && detail !== "" && <Text style={{ fontSize: 11.5, color: colors.muted }}>{detail}</Text>}
    </View>
  );
  const knob = glyph !== undefined ? <Knob glyph={glyph} size={PAGE.knob} /> : null;
  const top = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: PAGE.row - 16 }}>
      {knob}
      {words}
      {!stack && children}
    </View>
  );
  return (
    <View
      {...(testID !== undefined ? { testID } : {})}
      style={{
        minHeight: PAGE.row,
        flexDirection: "column",
        justifyContent: "center",
        gap: 10,
        paddingTop: 8,
        paddingBottom: stack || below ? 12 : 8,
        paddingLeft: glyph !== undefined ? 8 : 16,
        paddingRight: 16,
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
