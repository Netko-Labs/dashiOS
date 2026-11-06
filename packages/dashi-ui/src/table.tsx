/**
 * A table in the Mac's style: a header of column titles that sort on a
 * click (an arrow on the sorted one), rows on alternating grounds, and the
 * selected rows in the one selection look (selection.tsx: the kombu wash,
 * its 3 px bar, ink). Long tables scroll; Metal lays out only the
 * rows near the viewport (a scroll column of many children is virtualized).
 */

import { type DragFiles, type DropInfo, ScrollView, Svg, Text, View } from "@mirinjs/metal";
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

export interface TableProps<T, K extends string | number> {
  columns: ReadonlyArray<Column<T>>;
  /** Already sorted (`sortRows`) and filtered. */
  rows: readonly T[];
  rowKey: (row: T) => K;
  selected: K | null;
  onSelect: (key: K) => void;
  sort: SortState | null;
  onSort: (sort: SortState) => void;
  testID: string;
  /** Rows drawn in the quieter ink (another user's processes). */
  muted?: (row: T) => boolean;
  /** Several rows selected (a file manager's selection); when given it replaces `selected`. */
  selectedKeys?: ReadonlySet<K>;
  /** A right-click on a row, at window pixels. */
  onContextMenu?: (key: K, point: { x: number; y: number }) => void;
  rowHeight?: number;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
  /** Files a row drags out (a file manager's rows): see `View`'s `dragFiles`. */
  dragFiles?: (row: T) => DragFiles | undefined;
  /** Files dropped on a row: its handler, or null for a row that takes none. A row lights up while files are over it. */
  onDropRow?: (row: T) => ((event: DropInfo) => void) | null;
  /** The header of column titles; on by default (a list of choices may go without it). */
  header?: boolean;
}

const PAD = 10;

function cellBox(width: number | undefined, align: "left" | "right" | undefined) {
  return {
    ...(width !== undefined ? { width, flexShrink: 0 as const } : { flex: 1, minWidth: 0 }),
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: align === "right" ? ("flex-end" as const) : ("flex-start" as const),
    paddingHorizontal: PAD / 2,
  };
}

export function Table<T, K extends string | number>({
  columns,
  rows,
  rowKey,
  selected,
  onSelect,
  sort,
  onSort,
  testID,
  muted,
  selectedKeys,
  onContextMenu,
  rowHeight = 24,
  empty,
  dragFiles,
  onDropRow,
  header = true,
}: TableProps<T, K>) {
  const colors = useColors();
  const surface = useSurface();
  const [dropOver, setDropOver] = useState<K | null>(null);
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", minHeight: 0, backgroundColor: surface.card }}>
      {header && (
        <View style={{ height: 26, flexShrink: 0, flexDirection: "row", paddingHorizontal: PAD / 2, borderBottomWidth: 1, borderColor: colors.separator }}>
          {columns.map((column, index) => {
            const sorted = sort?.key === column.key;
            return (
              <View
                key={column.key}
                testID={`${testID}:sort:${column.key}`}
                onPress={() => onSort(nextSort(sort, column))}
                style={{
                  ...cellBox(column.width, column.align),
                  gap: 3,
                  borderLeftWidth: index > 0 ? 1 : 0,
                  borderColor: colors.separator,
                  hoverBackgroundColor: colors.button,
                }}
              >
                <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: sorted ? "bold" : "semibold", color: sorted ? colors.text : colors.textMuted }}>
                  {column.title}
                </Text>
                {sorted && <Svg markup={sort.ascending ? CHEVRON_UP : CHEVRON_DOWN} size={10} color={colors.textMuted} />}
              </View>
            );
          })}
        </View>
      )}
      {rows.length === 0 && empty !== undefined ? (
        <View style={{ flex: 1 }}>{empty}</View>
      ) : (
        <ScrollView testID={`${testID}:rows`} style={{ flex: 1, flexDirection: "column", paddingHorizontal: PAD / 2 }}>
          {rows.map((row, index) => {
            const key = rowKey(row);
            const chosen = selectedKeys ? selectedKeys.has(key) : key === selected;
            const ink = chosen ? colors.onSelection : muted?.(row) ? colors.textMuted : colors.text;
            const drags = dragFiles?.(row);
            const drop = onDropRow?.(row) ?? null;
            return (
              <View
                key={key}
                testID={`${testID}:row:${key}`}
                onPress={() => onSelect(key)}
                {...(drags ? { dragFiles: drags } : {})}
                {...(drop
                  ? {
                      onDrop: (event: DropInfo) => {
                        if (event.phase === "enter") setDropOver(key);
                        else if (event.phase === "leave" || event.phase === "drop") setDropOver((over) => (over === key ? null : over));
                        drop(event);
                      },
                    }
                  : {})}
                {...(onContextMenu ? { onContextMenu: (point: { x: number; y: number }) => onContextMenu(key, point) } : {})}
                style={{
                  height: rowHeight,
                  flexShrink: 0,
                  flexDirection: "row",
                  borderRadius: 5,
                  backgroundColor: chosen ? colors.selectionWash : index % 2 === 1 ? surface.stripe : "#00000000",
                  ...(dropOver === key ? { borderWidth: 2, borderColor: colors.selection } : {}),
                }}
              >
                {chosen && <SelectionBar rowHeight={rowHeight} />}
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
          })}
        </ScrollView>
      )}
    </View>
  );
}
