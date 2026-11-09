/**
 * A table in the Mac's style: a header of column titles that sort on a
 * click (an arrow on the sorted one), rows on alternating grounds, and the
 * selected rows in the one selection look (selection.tsx: the kombu wash,
 * its 3 px bar, ink). Long tables scroll; Metal lays out only the
 * rows near the viewport (a scroll column of many children is virtualized).
 */

import { type DragFiles, type DropInfo, type Modifiers, type PointerInfo, ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { CHEVRON_DOWN, CHEVRON_UP } from "./glyphs.ts";
import { SelectionBar } from "./selection.tsx";
import { holdOrder, nextSort, type SortableColumn, type SortState } from "./table-sort.ts";
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
  /** A click on a row, with the keys held (⇧ and ❖ extend a selection, PA-10). */
  onSelect: (key: K, held: Modifiers) => void;
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
  /**
   * For a list that re-sorts as it goes (Activity Monitor's processes): the
   * rows keep their places while the pointer is over them (and `STEADY_MS`
   * after it leaves), while one is held, and for `STEADY_SELECTED_MS` after
   * the selection changes, so a click lands on the row that was aimed at and
   * a row just chosen doesn't jump away. A click on a column's title sorts at once.
   */
  steady?: boolean;
}

const PAD = 10;
/** Room under the last row, so its wash never runs into the window's rounded corner. */
const END_INSET = 8;
/** How long rows stay put after the pointer last crossed one, or left the list. */
export const STEADY_MS = 1000;
/** How long rows stay put after the selection changed. */
export const STEADY_SELECTED_MS = 3000;

/**
 * `rows`, or while the pointer is over them or a row was just chosen, the order they were drawn in (`holdOrder`).
 * A new sort (`sortId`), from the header or from the app (a tab, a menu, a key), shows at once.
 */
function useSteadyRows<T, K>(rows: readonly T[], rowKey: (row: T) => K, enabled: boolean, selected: K | null, sortId: string) {
  const [over, setOver] = useState(false);
  const [timed, setTimed] = useState(false);
  const drawn = useRef<K[]>([]);
  const drawnSort = useRef(sortId);
  if (drawnSort.current !== sortId) {
    drawnSort.current = sortId;
    drawn.current = [];
  }
  const pressing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const hold = useCallback(
    (ms: number = STEADY_MS): void => {
      if (!enabled) return;
      if (timer.current) clearTimeout(timer.current);
      setTimed(true);
      timer.current = setTimeout(() => {
        timer.current = null;
        // A press outlasting the wait lets go on release.
        if (!pressing.current) setTimed(false);
      }, ms);
    },
    [enabled],
  );
  useEffect(() => {
    if (selected !== null) hold(STEADY_SELECTED_MS);
  }, [selected, hold]);
  const holding = enabled && (over || timed);
  const shown = holding ? holdOrder(drawn.current, rows, rowKey) : [...rows];
  drawn.current = shown.map(rowKey);
  return {
    shown,
    /** The pointer crossed onto a row. */
    aim: () => hold(),
    /** The pointer came over the list (`true`) or left it. */
    pointerOver: (inside: boolean): void => {
      if (!enabled) return;
      setOver(inside);
      if (!inside) hold();
    },
    /** The button went down on a row, or came up. */
    press: (down: boolean): void => {
      pressing.current = down;
      hold();
    },
    /** A new sort was asked for: show it now. */
    release: (): void => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setTimed(false);
      drawn.current = [];
    },
  };
}

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
  steady = false,
}: TableProps<T, K>) {
  const colors = useColors();
  const surface = useSurface();
  const [dropOver, setDropOver] = useState<K | null>(null);
  const { shown, aim, pointerOver, press, release } = useSteadyRows(rows, rowKey, steady, selected, sort ? `${sort.key}:${sort.ascending}` : "");
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
                onPress={() => {
                  release();
                  onSort(nextSort(sort, column));
                }}
                style={{
                  ...cellBox(column.width, column.align),
                  gap: 3,
                  // The divider takes its 1 from the padding, so a title starts on its values' edge.
                  borderLeftWidth: index > 0 ? 1 : 0,
                  ...(index > 0 ? { paddingLeft: PAD / 2 - 1 } : {}),
                  borderColor: colors.separator,
                  hoverBackgroundColor: colors.button,
                }}
              >
                {/* A right-aligned column's title ends on its figures' edge, its arrow before it; a one-line Text fills its cell, so this one is bare. */}
                {column.align === "right" && sorted && <Svg markup={sort.ascending ? CHEVRON_UP : CHEVRON_DOWN} size={10} color={colors.textMuted} />}
                {column.align === "right" ? (
                  <Text style={{ fontSize: 11, fontWeight: sorted ? "bold" : "semibold", color: sorted ? colors.text : colors.textMuted }}>{column.title}</Text>
                ) : (
                  <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: sorted ? "bold" : "semibold", color: sorted ? colors.text : colors.textMuted }}>
                    {column.title}
                  </Text>
                )}
                {column.align !== "right" && sorted && <Svg markup={sort.ascending ? CHEVRON_UP : CHEVRON_DOWN} size={10} color={colors.textMuted} />}
              </View>
            );
          })}
        </View>
      )}
      {rows.length === 0 && empty !== undefined ? (
        <View style={{ flex: 1 }}>{empty}</View>
      ) : (
        <ScrollView
          testID={`${testID}:rows`}
          {...(steady ? { onHoverChange: pointerOver } : {})}
          // The last row clears the window's rounded corner when scrolled to the end.
          style={{ flex: 1, flexDirection: "column", paddingHorizontal: PAD / 2, paddingBottom: END_INSET }}
        >
          {shown.map((row, index) => {
            const key = rowKey(row);
            const chosen = selectedKeys ? selectedKeys.has(key) : key === selected;
            const ink = chosen ? colors.onSelection : muted?.(row) ? colors.textMuted : colors.text;
            const drags = dragFiles?.(row);
            const drop = onDropRow?.(row) ?? null;
            return (
              <View
                key={key}
                testID={`${testID}:row:${key}`}
                onPress={(event) => onSelect(key, event.modifiers)}
                {...(steady
                  ? {
                      onHoverChange: (hovered: boolean) => {
                        if (hovered) aim();
                      },
                      onPointer: (event: PointerInfo) => {
                        if (event.phase !== "move") press(event.phase === "down");
                      },
                    }
                  : {})}
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
