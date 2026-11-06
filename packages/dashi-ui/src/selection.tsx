/**
 * One selection look (docs/design.html, CO-9): a selected row in a list, a
 * table or a sidebar sits on a kombu wash (`selectionWash`) with a 3 px kombu
 * bar at its left edge (`selectionBar`), and every word and glyph on it is ink
 * (`onSelection`), as the launcher's rows are. No solid kombu fill under white
 * text: muted words would fall under 4.5:1 there, and two looks for one job
 * read as two jobs. Selected text in a field is on the same wash
 * (`TextSelectionLook`).
 */

import { TextInputDefaults, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { useColors } from "./theme/index.ts";
import type { Palette } from "./theme/palette.ts";

/** The bar: 3 wide, 20 tall on a 40 px launcher row, a little shorter on shorter rows. */
export const SELECTION_BAR = { width: 3, height: 20, inset: 6 } as const;

/** The bar's height on a row this tall: 20 at most, with at least 6 above and below it. */
export function selectionBarHeight(rowHeight: number): number {
  return Math.max(0, Math.min(SELECTION_BAR.height, rowHeight - 2 * SELECTION_BAR.inset));
}

/**
 * The 3 px bar at a selected row's left edge, centered on it. Put it first in
 * the row. `rowHeight` for a row of fixed height; a row that grows with its
 * text (Notes' list) leaves it out, and the bar is centered on what it gets.
 */
export function SelectionBar({ rowHeight }: { rowHeight?: number }) {
  const colors = useColors();
  const bar = { width: SELECTION_BAR.width, borderRadius: SELECTION_BAR.width / 2, backgroundColor: colors.selectionBar };
  if (rowHeight === undefined) {
    return (
      <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: SELECTION_BAR.width, flexDirection: "column", justifyContent: "center" }}>
        <View style={{ ...bar, height: SELECTION_BAR.height }} />
      </View>
    );
  }
  const height = selectionBarHeight(rowHeight);
  return <View style={{ ...bar, position: "absolute", left: 0, top: (rowHeight - height) / 2, height }} />;
}

/** A row's colors, selected or not: its ground and hover, its words, its quiet words, its glyphs. */
export interface RowLook {
  ground: string;
  hover: string;
  ink: string;
  quiet: string;
  glyph: string;
}

const CLEAR = "#00000000";

/** How a list, table or sidebar row is colored: on the wash every word is ink; at rest, glyphs are muted (CO-2). */
export function rowLook(colors: Palette, selected: boolean): RowLook {
  return selected
    ? { ground: colors.selectionWash, hover: colors.selectionWash, ink: colors.onSelection, quiet: colors.onSelection, glyph: colors.onSelection }
    : { ground: CLEAR, hover: colors.button, ink: colors.text, quiet: colors.textMuted, glyph: colors.textMuted };
}

/**
 * Every text field below it draws its selected text on `selectionWash`, under its own
 * ink (CO-9), in the live palette. A surface's root puts it around its tree once.
 */
export function TextSelectionLook({ children }: { children: ReactNode }) {
  const colors = useColors();
  return <TextInputDefaults.Provider value={{ selectionColor: colors.selectionWash }}>{children}</TextInputDefaults.Provider>;
}
