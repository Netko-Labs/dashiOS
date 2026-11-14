/**
 * A table in the Mac's style: a header of column titles that sort on a
 * click (an arrow on the sorted one), rows on alternating grounds, and the
 * selected rows in the one selection look (selection.tsx: the kombu wash,
 * its 3 px bar, ink). Long tables scroll; Metal lays out only the
 * rows near the viewport (a scroll column of many children is virtualized).
 */

import { type DragFiles, type DropInfo, type Modifiers, ScrollView, View } from "@mirinjs/metal";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { type Column, TABLE_PAD, TableHeader, TableRow } from "./table-parts.tsx";
import { holdOrder, type SortState } from "./table-sort.ts";
import { useSurface } from "./theme/index.ts";

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
  /**
   * Off: the rows take no press, and the view around the table says what a
   * click on one does (Files' list: a press on a row's blank part, dragged,
   * is a marquee, and only the view that owns the press hears its click and
   * the keys held). `onSelect` is then never called.
   */
  rowPress?: boolean;
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
  rowPress = true,
  steady = false,
}: TableProps<T, K>) {
  const surface = useSurface();
  const { shown, aim, pointerOver, press, release } = useSteadyRows(rows, rowKey, steady, selected, sort ? `${sort.key}:${sort.ascending}` : "");
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", minHeight: 0, backgroundColor: surface.card }}>
      {header && (
        <TableHeader
          columns={columns}
          sort={sort}
          testID={testID}
          onSort={(next) => {
            release();
            onSort(next);
          }}
        />
      )}
      {rows.length === 0 && empty !== undefined ? (
        <View style={{ flex: 1 }}>{empty}</View>
      ) : (
        <ScrollView
          testID={`${testID}:rows`}
          {...(steady ? { onHoverChange: pointerOver } : {})}
          // The last row clears the window's rounded corner when scrolled to the end.
          style={{ flex: 1, flexDirection: "column", paddingHorizontal: TABLE_PAD / 2, paddingBottom: END_INSET }}
        >
          {shown.map((row, index) => {
            const key = rowKey(row);
            const drags = dragFiles?.(row);
            return (
              <TableRow
                key={key}
                testID={`${testID}:row:${key}`}
                row={row}
                columns={columns}
                striped={index % 2 === 1}
                chosen={selectedKeys ? selectedKeys.has(key) : key === selected}
                muted={muted?.(row) ?? false}
                height={rowHeight}
                onSelect={rowPress ? (held) => onSelect(key, held) : null}
                {...(steady ? { steady: { aim, press } } : {})}
                {...(drags ? { dragFiles: drags } : {})}
                onDrop={onDropRow?.(row) ?? null}
                {...(onContextMenu ? { onContextMenu: (point: { x: number; y: number }) => onContextMenu(key, point) } : {})}
              />
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
