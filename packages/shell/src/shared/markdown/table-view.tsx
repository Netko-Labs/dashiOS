/**
 * A Markdown table drawn as a table (table.ts reads it): the header row on a
 * wash, columns as wide as their words ask (`columnsOf`), cells that wrap.
 * Notes draws a note's tables with it, and the launcher an extension's
 * detail (a pull request's body).
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Text, View } from "@mirinjs/metal";
import { columnsOf, type Table } from "./table.ts";

const CLEAR = "#00000000";
/** The header's words are semibold, about this much wider than a row's: a column never breaks its header's longest word. */
const BOLD = 1.12;

export interface TableViewProps {
  table: Table;
  /** A cell's words as drawn (each caller drops its own Markdown marks). */
  cellText: (cell: string) => string;
  /** The words' size. */
  size: number;
  /** About the width of a letter at that size, for a column's least width. */
  letter: number;
  onLayout?: (bounds: Bounds) => void;
  testID?: string;
}

export function TableView({ table, cellText, size, letter, onLayout, testID }: TableViewProps) {
  const colors = useColors();
  const columns = columnsOf(table);
  const row = (cells: readonly string[], index: number, header: boolean) => (
    <View
      key={index}
      style={{
        flexDirection: "row",
        backgroundColor: header ? colors.button : CLEAR,
        borderTopWidth: index === 0 ? 0 : 1,
        borderColor: colors.separator,
      }}
    >
      {cells.map((cell, column) => (
        // Cells have no identity beyond their place: a cell is its column.
        <View
          key={column}
          style={{
            flex: columns[column]?.weight ?? 1,
            minWidth: Math.ceil((columns[column]?.floor ?? 0) * letter * BOLD) + 16,
            paddingTop: 5,
            paddingBottom: 5,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <Text style={{ fontSize: size, fontWeight: header ? "semibold" : "normal", color: colors.text, textAlign: table.align[column] ?? "left" }}>
            {cellText(cell)}
          </Text>
        </View>
      ))}
    </View>
  );
  return (
    <View
      {...(testID ? { testID } : {})}
      {...(onLayout ? { onLayout } : {})}
      // Never squeezed: in a column shorter than its words (the launcher's detail), a box that clips (its corners) would
      // otherwise shrink to its borders, as its least height is 0 where a text's is its lines.
      style={{ flexShrink: 0, flexDirection: "column", borderWidth: 1, borderColor: colors.separator, borderRadius: 6, overflow: "hidden" }}
    >
      {row(table.header, 0, true)}
      {table.rows.map((cells, index) => row(cells, index + 1, false))}
    </View>
  );
}
