/** A table's pieces (table.tsx): what a column is, the header of titles that sort, and one row. */

import { type DragFiles, type DropInfo, type Modifiers, type PointerInfo, type PressInfo, Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { CHEVRON_DOWN, CHEVRON_UP } from "./glyphs.ts";
import { SelectionBar } from "./selection.tsx";
import { nextSort, type SortableColumn, type SortState } from "./table-sort.ts";
import { useColors, useSurface } from "./theme/index.ts";

export interface Column<T> extends SortableColumn<T> {
  title: string;
  /** Pixels; columns without one share what is left. */
  width?: number;
  align?: "left" | "right";
  /** Draws the cell instead of its text (an icon beside the name); on a selected row its words are `onSelection` ink. */
  cell?: (row: T, selected: boolean) => ReactNode;
}

export const TABLE_PAD = 10;

function cellBox(width: number | undefined, align: "left" | "right" | undefined) {
  return {
    ...(width !== undefined ? { width, flexShrink: 0 as const } : { flex: 1, minWidth: 0 }),
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: align === "right" ? ("flex-end" as const) : ("flex-start" as const),
    paddingHorizontal: TABLE_PAD / 2,
  };
}

/** The column titles: a click sorts by one, and the sorted one carries an arrow. */
export function TableHeader<T>({
  columns,
  sort,
  onSort,
  testID,
}: {
  columns: ReadonlyArray<Column<T>>;
  sort: SortState | null;
  onSort: (sort: SortState) => void;
  testID: string;
}) {
  const colors = useColors();
  return (
    <View style={{ height: 26, flexShrink: 0, flexDirection: "row", paddingHorizontal: TABLE_PAD / 2, borderBottomWidth: 1, borderColor: colors.separator }}>
      {columns.map((column, index) => {
        const sorted = sort?.key === column.key;
        const arrow = sorted && <Svg markup={sort.ascending ? CHEVRON_UP : CHEVRON_DOWN} size={10} color={colors.textMuted} />;
        const ink = { fontSize: 11, fontWeight: sorted ? "bold" : "semibold", color: sorted ? colors.text : colors.textMuted } as const;
        return (
          <View
            key={column.key}
            testID={`${testID}:sort:${column.key}`}
            onPress={() => onSort(nextSort(sort, column))}
            style={{
              ...cellBox(column.width, column.align),
              gap: 3,
              // The divider takes its 1 from the padding, so a title starts on its values' edge.
              borderLeftWidth: index > 0 ? 1 : 0,
              ...(index > 0 ? { paddingLeft: TABLE_PAD / 2 - 1 } : {}),
              borderColor: colors.separator,
              hoverBackgroundColor: colors.button,
            }}
          >
            {/* A right-aligned column's title ends on its figures' edge, its arrow before it; a one-line Text fills its cell, so this one is bare. */}
            {column.align === "right" && arrow}
            {column.align === "right" ? (
              <Text style={ink}>{column.title}</Text>
            ) : (
              <Text numberOfLines={1} style={ink}>
                {column.title}
              </Text>
            )}
            {column.align !== "right" && arrow}
          </View>
        );
      })}
    </View>
  );
}

export interface TableRowProps<T> {
  row: T;
  columns: ReadonlyArray<Column<T>>;
  testID: string;
  /** On the alternate ground. */
  striped: boolean;
  chosen: boolean;
  muted: boolean;
  height: number;
  /** A click on the row; null for a row that takes no press (`Table`'s `rowPress`). */
  onSelect: ((held: Modifiers) => void) | null;
  /** A steady table's row says when the pointer aims at it and when the button goes down or up on it. */
  steady?: { aim: () => void; press: (down: boolean) => void };
  dragFiles?: DragFiles;
  /** Files dropped on the row; it lights up while they are over it. */
  onDrop: ((event: DropInfo) => void) | null;
  onContextMenu?: (point: { x: number; y: number }) => void;
}

export function TableRow<T>({ row, columns, testID, striped, chosen, muted, height, onSelect, steady, dragFiles, onDrop, onContextMenu }: TableRowProps<T>) {
  const colors = useColors();
  const surface = useSurface();
  const [dropOver, setDropOver] = useState(false);
  const ink = chosen ? colors.onSelection : muted ? colors.textMuted : colors.text;
  return (
    <View
      testID={testID}
      {...(onSelect ? { onPress: (event: PressInfo) => onSelect(event.modifiers) } : {})}
      {...(steady
        ? {
            onHoverChange: (hovered: boolean) => {
              if (hovered) steady.aim();
            },
            onPointer: (event: PointerInfo) => {
              if (event.phase !== "move") steady.press(event.phase === "down");
            },
          }
        : {})}
      {...(dragFiles ? { dragFiles } : {})}
      {...(onDrop
        ? {
            onDrop: (event: DropInfo) => {
              if (event.phase === "enter") setDropOver(true);
              else if (event.phase === "leave" || event.phase === "drop") setDropOver(false);
              onDrop(event);
            },
          }
        : {})}
      {...(onContextMenu ? { onContextMenu } : {})}
      style={{
        height,
        flexShrink: 0,
        flexDirection: "row",
        borderRadius: 5,
        backgroundColor: chosen ? colors.selectionWash : striped ? surface.stripe : "#00000000",
        ...(dropOver ? { borderWidth: 2, borderColor: colors.selection } : {}),
      }}
    >
      {chosen && <SelectionBar rowHeight={height} />}
      {columns.map((column) => (
        <View key={column.key} style={cellBox(column.width, column.align)}>
          {column.cell ? (
            column.cell(row, chosen)
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 12, color: ink, textAlign: column.align ?? "left" }}>
              {column.text(row)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
