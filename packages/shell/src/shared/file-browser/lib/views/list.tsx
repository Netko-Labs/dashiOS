/** The list view: the kit's Table with Name, Date Modified, Size, and Kind (Where while searching), sortable. */

import { type Column, Table, useColors, useDark } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import type { FileItem } from "../../../files/index.ts";
import { useFiles, useFilesState } from "../../context.ts";
import { FileIcon } from "../../file-icon.tsx";
import { dragPaths } from "../drag.ts";
import { iconFor } from "../icons.ts";
import { columnMode, fileColumns, fitColumns } from "../sort.ts";
import { RenameField } from "./rename-field.tsx";

const ROW = 26;

interface NameCellProps {
  item: FileItem;
  selected: boolean;
  /** It was cut: drawn faint until it is pasted. */
  faded: boolean;
  renaming: boolean;
  emblems: React.ComponentProps<typeof FileIcon>["emblems"];
}

/** The Name column: the file's icon and its name, or the field it is renamed in. */
function NameCell({ item, selected, faded, renaming, emblems }: NameCellProps) {
  const colors = useColors();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        flex: 1,
        opacity: faded ? 0.45 : item.hidden ? 0.65 : 1,
      }}
    >
      <FileIcon item={item} size={16} emblems={emblems} />
      {renaming ? (
        <RenameField item={item} />
      ) : (
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? colors.onSelection : colors.text }}>
            {item.name}
          </Text>
        </View>
      )}
    </View>
  );
}

export function ListView({ items, empty }: { items: readonly FileItem[]; empty: React.ReactNode }) {
  const { store, actions, ops } = useFiles();
  const state = useFilesState();
  const colors = useColors();
  const dark = useDark();
  const byPath = useMemo(() => new Map(items.map((item) => [item.path, item])), [items]);
  const mode = columnMode(state);
  // The list's width: a narrow one shows fewer columns, Name last to go (sort.ts).
  const [width, setWidth] = useState(0);
  const cut = new Set(state.clipboard?.cut ? state.clipboard.paths : []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `cut` is made from the clipboard each render; the clipboard says when it changed
  const columns = useMemo<Column<FileItem>[]>(
    () =>
      fitColumns(fileColumns(mode), width).map((column) =>
        column.key === "name"
          ? {
              ...column,
              cell: (item, selected) => (
                <NameCell item={item} selected={selected} faded={cut.has(item.path)} renaming={state.renaming === item.path} emblems={store.emblems} />
              ),
            }
          : column,
      ),
    // The cut set is read at draw time through the closure; a new clipboard is a new state and a new render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, width, colors, state.clipboard, state.renaming],
  );
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
        dragFiles={(item) => ({ paths: dragPaths(item.path, state.selection), icon: iconFor(item, dark, store.emblems) })}
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
