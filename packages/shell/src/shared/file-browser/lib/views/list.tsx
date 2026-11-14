/** The list view: the kit's Table with Name, Date Modified, Size, and Kind (Where while searching), sortable. */

import { type Column, Table, useColors, useDark } from "@dashi/ui";
import { type DragFiles, type PointerInfo, Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import type { FileItem } from "../../../files/index.ts";
import { useFiles, useFilesState } from "../../context.ts";
import { FileIcon } from "../../file-icon.tsx";
import { textWidth } from "../../tile-name.ts";
import { dragPaths } from "../drag.ts";
import { iconFor } from "../icons.ts";
import type { Rect } from "../marquee/geometry.ts";
import { marqueeOf } from "../marquee/of.ts";
import { columnMode, fileColumns, fitColumns } from "../sort.ts";
import { RenameField } from "./rename-field.tsx";

const ROW = 26;
/** The table's rows start this far in from its sides, and it keeps this much under the last (`@dashi/ui`'s `Table`). */
const ROW_INSET = 5;
const LIST_END = 8;
/** The Name cell's icon and the gap after it. */
const ICON = 16;
const ICON_GAP = 7;

/** Where each of `count` rows is, in the pixels of what scrolls, in a list `width` wide. */
export function rowRects(count: number, width: number): Rect[] {
  return Array.from({ length: count }, (_, at) => ({ x: ROW_INSET, y: at * ROW, width: Math.max(0, width - 2 * ROW_INSET), height: ROW }));
}

/** How wide a name is drawn in the list, at its 12 px type: estimated (tile-name.ts), a little over. */
export const nameWidth = (name: string): number => Math.ceil(textWidth(name) * 12) + 6;

interface NameCellProps {
  item: FileItem;
  selected: boolean;
  /** It was cut: drawn faint until it is pasted. */
  faded: boolean;
  renaming: boolean;
  emblems: React.ComponentProps<typeof FileIcon>["emblems"];
  /** What a press on the icon or the name drags out. */
  drag: DragFiles;
  /** The pointer on the icon or the name. */
  onGrip: (event: PointerInfo) => void;
}

/**
 * The Name column: the file's icon and its name, or the field it is renamed
 * in. The icon and the name are the item, as in the Finder's list: a press
 * there drags the file, and a press on the rest of the row, dragged, draws
 * a marquee (D99). A click anywhere on the row still selects it.
 */
function NameCell({ item, selected, faded, renaming, emblems, drag, onGrip }: NameCellProps) {
  const colors = useColors();
  const look = { flexDirection: "row", alignItems: "center", gap: ICON_GAP, minWidth: 0, opacity: faded ? 0.45 : item.hidden ? 0.65 : 1 } as const;
  if (renaming) {
    return (
      <View style={{ ...look, flex: 1 }}>
        <FileIcon item={item} size={ICON} emblems={emblems} />
        <RenameField item={item} />
      </View>
    );
  }
  return (
    <View style={{ flexDirection: "row", flex: 1, minWidth: 0 }}>
      <View
        testID={`list:name:${item.path}`}
        dragFiles={drag}
        // The press is the item's: the listing around it hears none of it, so no marquee starts here.
        onPointer={onGrip}
        style={{ ...look, flexShrink: 1 }}
      >
        <FileIcon item={item} size={ICON} emblems={emblems} />
        <View style={{ width: nameWidth(item.name), flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? colors.onSelection : colors.text }}>
            {item.name}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** The list's columns at `width`, the Name one drawn with its icon (and the field it is renamed in). */
function useFileColumns(width: number): Column<FileItem>[] {
  const { store } = useFiles();
  const state = useFilesState();
  const colors = useColors();
  const dark = useDark();
  const mode = columnMode(state);
  const cut = new Set(state.clipboard?.cut ? state.clipboard.paths : []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cut` is made from the clipboard each render; the clipboard says when it changed
  const columns = useMemo<Column<FileItem>[]>(
    () =>
      fitColumns(fileColumns(mode), width).map((column) =>
        column.key === "name"
          ? {
              ...column,
              cell: (item, selected) => (
                <NameCell
                  item={item}
                  selected={selected}
                  faded={cut.has(item.path)}
                  renaming={state.renaming === item.path}
                  emblems={store.emblems}
                  drag={{ paths: dragPaths(item.path, state.selection), icon: iconFor(item, dark, store.emblems) }}
                  onGrip={marqueeOf(store).itemPointer}
                />
              ),
            }
          : column,
      ),
    // The cut set is read at draw time through the closure; a new clipboard is a new state and a new render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, width, colors, dark, state.clipboard, state.renaming, state.selection],
  );
  return columns;
}

export function ListView({ items, empty }: { items: readonly FileItem[]; empty: React.ReactNode }) {
  const { store, actions, ops } = useFiles();
  const state = useFilesState();
  const byPath = useMemo(() => new Map(items.map((item) => [item.path, item])), [items]);
  const marquee = marqueeOf(store);
  // The list's width: a narrow one shows fewer columns, Name last to go (sort.ts).
  const [width, setWidth] = useState(0);
  const columns = useFileColumns(width);
  // Where the rows are, for a marquee (lib/marquee/).
  const rects = useMemo(() => rowRects(items.length, width), [items.length, width]);
  marquee.model =
    items.length === 0
      ? null
      : {
          scrollID: "list:rows",
          contentHeight: items.length * ROW + LIST_END,
          paths: items.map((item) => item.path),
          rects,
          nodeOf: (path) => `list:row:${path}`,
        };
  return (
    <View
      testID="list:frame"
      style={{ flex: 1, minHeight: 0 }}
      onLayout={(bounds) => {
        if (Math.round(bounds.width) !== width) setWidth(Math.round(bounds.width));
        store.setLayout({ columns: 1, page: Math.max(1, Math.floor(bounds.height / ROW) - 2) });
      }}
    >
      <Table
        testID="list"
        columns={columns}
        rows={items}
        rowKey={(item) => item.path}
        selected={null}
        selectedKeys={new Set(state.selection)}
        onSelect={(path, held) => {
          // The click that ends a marquee started on a row's blank part is the marquee's, not the row's.
          if (marquee.press(held)) return;
          const item = byPath.get(path);
          if (item) store.click(item, held);
          actions.refocus();
        }}
        onContextMenu={(path, point) => {
          const item = byPath.get(path);
          if (item) store.contextOn(item);
          actions.menu(point, "item");
        }}
        sort={store.effectiveSort()}
        onSort={(next) => store.setSort(next)}
        muted={(item) => item.hidden}
        onDropRow={(item) =>
          item.kind === "folder" && ops
            ? (event) => {
                if (event.phase !== "drop") return;
                void ops.drop(event.paths, item.path, event);
                actions.refocus();
              }
            : null
        }
        empty={empty}
        rowHeight={ROW}
      />
    </View>
  );
}
