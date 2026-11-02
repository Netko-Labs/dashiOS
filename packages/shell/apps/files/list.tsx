/** The list view: the kit's Table with Name, Date Modified, Size, and Kind (Where while searching), sortable. */

import { Image, Text, View } from "@mirinjs/metal";
import { useMemo } from "react";
import { type Column, Table, useColors } from "@dashi/ui";
import { useFiles, useFilesState } from "./context.ts";
import { columnMode, fileColumns } from "./sort.ts";
import { iconFor } from "./icons.ts";
import type { FileItem } from "./items.ts";

export function ListView({ items, empty }: { items: readonly FileItem[]; empty: React.ReactNode }) {
  const { store, actions } = useFiles();
  const state = useFilesState();
  const colors = useColors();
  const byPath = useMemo(() => new Map(items.map((item) => [item.path, item])), [items]);
  const mode = columnMode(state);
  const cut = new Set(state.clipboard?.cut ? state.clipboard.paths : []);
  const columns = useMemo<Column<FileItem>[]>(
    () =>
      fileColumns(mode).map((column) =>
        column.key === "name"
          ? {
              ...column,
              cell: (item, selected) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 7,
                    minWidth: 0,
                    flex: 1,
                    opacity: cut.has(item.path) ? 0.45 : item.hidden ? 0.65 : 1,
                  }}
                >
                  <Image source={iconFor(item)} resizeMode="contain" style={{ width: 16, height: 16 }} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 12, color: selected ? "#ffffff" : colors.text }}>
                      {item.name}
                    </Text>
                  </View>
                </View>
              ),
            }
          : column,
      ),
    // The cut set is read at draw time through the closure; a new clipboard is a new state and a new render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, colors, state.clipboard],
  );
  return (
    <Table
      testID="list"
      columns={columns}
      rows={items}
      rowKey={(item) => item.path}
      selected={null}
      selectedKeys={new Set(state.selection)}
      onSelect={(path) => {
        const item = byPath.get(path);
        if (item) store.click(item);
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
      empty={empty}
      rowHeight={26}
    />
  );
}
