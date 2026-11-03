/**
 * The icon view: tiles in rows that fill the width. The rows are the scroll
 * column's children (Metal lays out only the ones near the viewport), and
 * the number of columns comes from the width the view is laid out at.
 */

import { useColors } from "@dashi/ui";
import { Image, ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { useFiles, useFilesState } from "./context.ts";
import { dragPaths } from "./drag.ts";
import { useDropTarget } from "./drop.ts";
import { middleEllipsis } from "./format.ts";
import { LINK_BADGE } from "./glyphs.ts";
import { iconFor, previewFor } from "./icons.ts";
import type { FileItem } from "./items.ts";

const TILE_WIDTH = 104;
const TILE_HEIGHT = 98;
/** Search results and Recents show where each item is, one line more. */
const TALL_TILE_HEIGHT = 114;
const PICTURE = 56;

function Tile({
  item,
  selected,
  dimmed,
  height,
  selection,
}: {
  item: FileItem;
  selected: boolean;
  dimmed: boolean;
  height: number;
  selection: readonly string[];
}) {
  const colors = useColors();
  const { store, actions } = useFiles();
  const picture = useMemo(() => previewFor(item, 128, store.env.cache), [item, store.env.cache]);
  const drop = useDropTarget(item.kind === "folder" ? item.path : null);
  const lit = selected || drop.over;
  return (
    <View
      testID={`item:${item.path}`}
      dragFiles={{ paths: dragPaths(item.path, selection), icon: picture ?? iconFor(item) }}
      {...drop.props}
      onPress={() => {
        store.click(item);
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
        backgroundColor: lit ? `${colors.selection}33` : "#00000000",
        hoverBackgroundColor: lit ? `${colors.selection}33` : `${colors.button}`,
      }}
    >
      <View style={{ width: PICTURE, height: PICTURE, alignItems: "center", justifyContent: "center" }}>
        {picture ? (
          <Image source={picture} resizeMode="contain" style={{ width: PICTURE, height: PICTURE, borderRadius: 3 }} />
        ) : (
          <Image source={iconFor(item)} resizeMode="contain" style={{ width: PICTURE, height: PICTURE }} />
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
        <View
          style={{
            maxWidth: TILE_WIDTH - 10,
            paddingHorizontal: 5,
            paddingVertical: 1,
            borderRadius: 5,
            backgroundColor: selected ? colors.selection : "#00000000",
          }}
        >
          <Text style={{ fontSize: 12, lineHeight: 15, color: selected ? "#ffffff" : colors.text, textAlign: "center" }}>{middleEllipsis(item.name, 24)}</Text>
        </View>
        {item.where !== undefined && (
          <Text numberOfLines={1} style={{ fontSize: 10, color: selected ? colors.text : colors.textMuted, textAlign: "center" }}>
            {middleEllipsis(item.where, 18)}
          </Text>
        )}
      </View>
    </View>
  );
}

export function Grid({ items, onColumns, empty }: { items: readonly FileItem[]; onColumns: (columns: number) => void; empty: React.ReactNode }) {
  const state = useFilesState();
  const [width, setWidth] = useState(0);
  const columns = Math.max(1, Math.floor((width - 20) / TILE_WIDTH));
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
        const next = Math.max(1, Math.floor((bounds.width - 20) / TILE_WIDTH));
        if (Math.round(bounds.width) !== width) setWidth(Math.round(bounds.width));
        onColumns(next);
      }}
      style={{ flex: 1, minHeight: 0 }}
    >
      {items.length === 0 ? (
        empty
      ) : (
        <ScrollView testID="grid:rows" style={{ flex: 1, flexDirection: "column", padding: 10, gap: 4 }}>
          {rows.map((row) => (
            <View key={row[0]?.path} style={{ flexDirection: "row", flexShrink: 0, height, gap: 0 }}>
              {row.map((item) => (
                <Tile key={item.path} item={item} selected={chosen.has(item.path)} dimmed={cut.has(item.path)} height={height} selection={state.selection} />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
