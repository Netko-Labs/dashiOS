/**
 * The icon view: tiles in rows that fill the width. The rows are the scroll
 * column's children (Metal lays out only the ones near the viewport), and
 * the number of columns comes from the width the view is laid out at; the
 * store hears it, so ← → ↑ ↓ move by place and by row (selection.ts).
 */

import { useColors, useDark } from "@dashi/ui";
import { Image, ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import { useFiles, useFilesState } from "./context.ts";
import { dragPaths } from "./drag.ts";
import { useDropTarget } from "./drop.ts";
import { FileIcon } from "./file-icon.tsx";
import { middleEllipsis } from "./format.ts";
import { LINK_BADGE } from "./glyphs.ts";
import { iconFor, previewFor, thumbnails } from "./icons.ts";
import type { FileItem } from "./items.ts";
import { RenameField } from "./rename-field.tsx";
import { tileName } from "./tile-name.ts";

const TILE_WIDTH = 104;
const TILE_HEIGHT = 98;
/** Search results and Recents show where each item is, one line more. */
const TALL_TILE_HEIGHT = 114;
const PICTURE = 56;
const ROW_GAP = 4;
const PADDING = 10;
/** The room a name has on each of its two lines under a tile, in ems of its 12 px type: 84 px. */
const NAME_ROOM = (TILE_WIDTH - 20) / 12;

/** How many tiles fit across `width`. */
export const columnsFor = (width: number): number => Math.max(1, Math.floor((width - 2 * PADDING) / TILE_WIDTH));

function Tile({
  item,
  selected,
  dimmed,
  height,
  selection,
  renaming,
}: {
  item: FileItem;
  selected: boolean;
  dimmed: boolean;
  height: number;
  selection: readonly string[];
  renaming: boolean;
}) {
  const colors = useColors();
  const dark = useDark();
  const { store, actions } = useFiles();
  // A thumbnail made since (thumbnailer.ts) is found on the next look.
  const made = useSyncExternalStore(thumbnails(store.env.cache).subscribe, thumbnails(store.env.cache).getVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `made` says when to look in the cache again
  const picture = useMemo(() => previewFor(item, 128, store.env.cache), [item, store.env.cache, made]);
  const drop = useDropTarget(item.kind === "folder" ? item.path : null);
  const lit = selected || drop.over;
  return (
    <View
      testID={`item:${item.path}`}
      dragFiles={{ paths: dragPaths(item.path, selection), icon: picture ?? iconFor(item, dark, store.emblems) }}
      {...drop.props}
      onPress={(event) => {
        store.click(item, event.modifiers);
        actions.refocus();
      }}
      onContextMenu={(point) => {
        store.contextOn(item);
        actions.menu(point, "item");
      }}
      style={{
        width: TILE_WIDTH,
        height,
        flexShrink: 0,
        alignItems: "center",
        paddingTop: 6,
        gap: 4,
        borderRadius: 8,
        opacity: dimmed ? 0.45 : item.hidden ? 0.65 : 1,
        backgroundColor: lit ? colors.selectionWash : "#00000000",
        hoverBackgroundColor: lit ? colors.selectionWash : colors.button,
      }}
    >
      <View style={{ width: PICTURE, height: PICTURE, alignItems: "center", justifyContent: "center" }}>
        {picture ? (
          <Image source={picture} resizeMode="contain" style={{ width: PICTURE, height: PICTURE, borderRadius: 3 }} />
        ) : (
          <FileIcon item={item} size={PICTURE} emblems={store.emblems} />
        )}
        {item.isLink && (
          <View
            style={{
              position: "absolute",
              left: 0,
              bottom: 0,
              width: 18,
              height: 18,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.menu,
              borderWidth: 1,
              borderColor: colors.separator,
            }}
          >
            <Svg markup={LINK_BADGE} size={11} color={colors.text} />
          </View>
        )}
      </View>
      <View style={{ width: TILE_WIDTH - 10, alignItems: "center" }}>
        {renaming ? (
          <RenameField item={item} width={TILE_WIDTH - 10} />
        ) : (
          <View style={{ maxWidth: TILE_WIDTH - 10, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ fontSize: 12, lineHeight: 15, color: selected ? colors.onSelection : colors.text, textAlign: "center" }}>
              {tileName(item.name, NAME_ROOM)}
            </Text>
          </View>
        )}
        {item.where !== undefined && (
          <Text numberOfLines={1} style={{ fontSize: 10, color: selected ? colors.onSelection : colors.textMuted, textAlign: "center" }}>
            {middleEllipsis(item.where, 18)}
          </Text>
        )}
      </View>
    </View>
  );
}

export function Grid({ items, empty }: { items: readonly FileItem[]; empty: React.ReactNode }) {
  const { store } = useFiles();
  const state = useFilesState();
  const [width, setWidth] = useState(0);
  const columns = columnsFor(width);
  const rows = useMemo(() => {
    const out: FileItem[][] = [];
    for (let at = 0; at < items.length; at += columns) out.push(items.slice(at, at + columns));
    return out;
  }, [items, columns]);
  const height = items.some((item) => item.where !== undefined) ? TALL_TILE_HEIGHT : TILE_HEIGHT;
  const chosen = new Set(state.selection);
  const cut = new Set(state.clipboard?.cut ? state.clipboard.paths : []);
  return (
    <View
      testID="grid"
      onLayout={(bounds) => {
        if (Math.round(bounds.width) !== width) setWidth(Math.round(bounds.width));
        store.setLayout({ columns: columnsFor(bounds.width), page: Math.max(1, Math.floor((bounds.height - 2 * PADDING) / (height + ROW_GAP))) });
      }}
      style={{ flex: 1, minHeight: 0 }}
    >
      {items.length === 0 ? (
        empty
      ) : (
        <ScrollView testID="grid:rows" style={{ flex: 1, flexDirection: "column", padding: PADDING, gap: ROW_GAP }}>
          {rows.map((row) => (
            <View key={row[0]?.path} style={{ flexDirection: "row", flexShrink: 0, height, gap: 0 }}>
              {row.map((item) => (
                <Tile
                  key={item.path}
                  item={item}
                  selected={chosen.has(item.path)}
                  dimmed={cut.has(item.path)}
                  height={height}
                  selection={state.selection}
                  renaming={state.renaming === item.path}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
