/**
 * The icon view: tiles in rows that fill the width. The rows are the scroll
 * column's children (Metal lays out only the ones near the viewport), and
 * the number of columns comes from the width the view is laid out at; the
 * store hears it, so ← → ↑ ↓ move by place and by row (selection.ts). The
 * measures, and what of a cell is the item, are grid-places.ts.
 */

import { useColors, useDark } from "@dashi/ui";
import { Image, ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { FileItem } from "../../../files/index.ts";
import { useFiles, useFilesState } from "../../context.ts";
import { useDropTarget } from "../../drop.ts";
import { FileIcon } from "../../file-icon.tsx";
import { LINK_BADGE } from "../../glyphs.ts";
import { fitMiddle, tileName } from "../../tile-name.ts";
import { dragPaths } from "../drag.ts";
import { iconFor, previewFor, thumbnails } from "../icons.ts";
import { marqueeOf } from "../marquee/of.ts";
import {
  columnsFor,
  gridHeight,
  gridInset,
  itemParts,
  NAME_BOX,
  NAME_GAP,
  NAME_HEIGHT,
  NAME_LINE,
  NAME_PAD_X,
  NAME_PAD_Y,
  NAME_ROOM,
  PADDING,
  PICTURE,
  PICTURE_TOP,
  ROW_GAP,
  TALL_TILE_HEIGHT,
  TILE_HEIGHT,
  TILE_WIDTH,
  tileRects,
} from "./grid-places.ts";
import { RenameField } from "./rename-field.tsx";

/** The room the "where" line has, in ems of its 10 px type: 90 px. */
const WHERE_ROOM = (TILE_WIDTH - 14) / 10;

/** A search result's folder, its middle taken out once to fit under the tile (never cut again at its end). */
export const whereLine = (where: string): string => fitMiddle(where, WHERE_ROOM);

/** The arrow on a link's picture. */
function LinkBadge() {
  const colors = useColors();
  return (
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
  );
}

/** What makes a view part of the item: its press, its drag, its menu. */
type Grip = Pick<React.ComponentProps<typeof View>, "dragFiles" | "onPointer" | "onPress" | "onContextMenu">;

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
  // The icon and the name are the item (D111): a press on either is the item's (it drags it, and the listing around
  // hears none of it, so no marquee starts there); a press on the rest of the cell is one on empty space.
  const grip: Grip = {
    dragFiles: { paths: dragPaths(item.path, selection), icon: picture ?? iconFor(item, dark, store.emblems) },
    onPointer: marqueeOf(store).itemPointer,
    onPress: (event) => {
      store.click(item, event.modifiers);
      actions.refocus();
    },
    onContextMenu: (point: { x: number; y: number }) => {
      store.contextOn(item);
      actions.menu(point, "item");
    },
  };
  const hover = lit ? "#00000000" : colors.button;
  return (
    <View
      testID={`cell:${item.path}`}
      // Files dropped anywhere on a folder's cell go into it.
      {...drop.props}
      style={{
        width: TILE_WIDTH,
        height,
        flexShrink: 0,
        alignItems: "center",
        paddingTop: PICTURE_TOP,
        gap: NAME_GAP,
        borderRadius: 8,
        opacity: dimmed ? 0.45 : item.hidden ? 0.65 : 1,
        backgroundColor: lit ? colors.selectionWash : "#00000000",
      }}
    >
      <View
        testID={`item:${item.path}`}
        {...grip}
        style={{ width: PICTURE, height: PICTURE, alignItems: "center", justifyContent: "center", borderRadius: 6, hoverBackgroundColor: hover }}
      >
        {picture ? (
          <Image source={picture} resizeMode="contain" style={{ width: PICTURE, height: PICTURE, borderRadius: 3 }} />
        ) : (
          <FileIcon item={item} size={PICTURE} emblems={store.emblems} />
        )}
        {item.isLink && <LinkBadge />}
      </View>
      <TileName item={item} selected={selected} renaming={renaming} grip={grip} hover={hover} />
    </View>
  );
}

/** A tile's name under its picture (the field it is renamed in), and under it where a search result is. */
function TileName({ item, selected, renaming, grip, hover }: { item: FileItem; selected: boolean; renaming: boolean; grip: Grip; hover: string }) {
  const colors = useColors();
  return (
    <View style={{ width: NAME_BOX, alignItems: "center" }}>
      {renaming ? (
        <RenameField item={item} width={NAME_BOX} />
      ) : (
        <View
          testID={`name:${item.path}`}
          {...grip}
          style={{
            maxWidth: NAME_BOX,
            paddingHorizontal: NAME_PAD_X,
            paddingVertical: NAME_PAD_Y,
            borderRadius: 4,
            hoverBackgroundColor: hover,
            ...(item.where !== undefined ? { height: NAME_HEIGHT } : {}),
          }}
        >
          <Text style={{ fontSize: 12, lineHeight: NAME_LINE, color: selected ? colors.onSelection : colors.text, textAlign: "center" }}>
            {tileName(item.name, NAME_ROOM)}
          </Text>
        </View>
      )}
      {item.where !== undefined && (
        <Text numberOfLines={1} style={{ fontSize: 10, color: selected ? colors.onSelection : colors.textMuted, textAlign: "center" }}>
          {whereLine(item.where)}
        </Text>
      )}
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
  // Where the cells are, and in each the icon and the name a marquee must touch (lib/marquee/).
  const rects = useMemo(() => tileRects(items.length, width, height), [items.length, width, height]);
  const tall = height === TALL_TILE_HEIGHT;
  const parts = useMemo(() => items.map((item, at) => itemParts(item.name, rects[at] ?? { x: 0, y: 0, width: 0, height: 0 }, tall)), [items, rects, tall]);
  marqueeOf(store).model =
    items.length === 0
      ? null
      : {
          contentHeight: gridHeight(items.length, width, height),
          paths: items.map((item) => item.path),
          rects,
          parts,
        };
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
        <ScrollView
          testID="grid:rows"
          // Where it is and how far it is scrolled, for a marquee and the keyboard's item (lib/marquee/place.ts).
          {...marqueeOf(store).place.props}
          style={{ flex: 1, flexDirection: "column", paddingVertical: PADDING, paddingHorizontal: gridInset(width), gap: ROW_GAP }}
        >
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
