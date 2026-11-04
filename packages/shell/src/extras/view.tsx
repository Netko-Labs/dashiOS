/**
 * The extras in the menu bar's status area (types.ts): each one's picture
 * and label in a pill like the status glyphs' own. A click activates it or
 * opens its menu (`menuOnClick`); a right-click opens its menu. An extra
 * that asks for attention gets a dot, as a Dock icon does.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Image, Svg, Text, View } from "@mirinjs/metal";
import { useRef } from "react";
import { type ExtrasStore, useExtras } from "./store.ts";
import type { MenuBarExtra } from "./types.ts";

/** The picture's size in the bar: the status glyphs' own. */
const SIZE = 16;

export interface ExtraItemsProps {
  store: ExtrasStore;
  /** The key of the extra whose menu is open, to draw its pill pressed. */
  openKey: string | null;
  /** Open (or close) the extra's menu below it, its right edge at `right`. */
  onMenu(extra: MenuBarExtra, right: number): void;
  /** A click on an extra that activates, at (x, y) in the bar's pixels. */
  onActivate(extra: MenuBarExtra, x: number, y: number): void;
}

export function ExtraItems({ store, openKey, onMenu, onActivate }: ExtraItemsProps) {
  const extras = useExtras(store);
  if (extras.length === 0) return null;
  return (
    // On a narrow screen the extras give way (clipped from the left) before Dashi's own items and the clock do.
    <View testID="extras" style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexShrink: 1, minWidth: 0, overflow: "hidden" }}>
      {extras.map((extra) => (
        <ExtraItem key={extra.key} extra={extra} open={openKey === extra.key} onMenu={onMenu} onActivate={onActivate} />
      ))}
    </View>
  );
}

function ExtraItem({
  extra,
  open,
  onMenu,
  onActivate,
}: {
  extra: MenuBarExtra;
  open: boolean;
  onMenu: ExtraItemsProps["onMenu"];
  onActivate: ExtraItemsProps["onActivate"];
}) {
  const colors = useColors();
  // Events carry the pill's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  const boxOf = (bounds?: Bounds): Bounds => bounds ?? laid.current ?? { x: 0, y: 0, width: 0, height: 0 };
  const press = (bounds?: Bounds) => {
    const box = boxOf(bounds);
    if (extra.menuOnClick) onMenu(extra, box.x + box.width);
    else onActivate(extra, box.x + box.width / 2, box.y + box.height);
  };
  return (
    <View
      testID={`extra:${extra.key}`}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPress={({ bounds }) => press(bounds)}
      onContextMenu={extra.hasMenu ? () => onMenu(extra, boxOf().x + boxOf().width) : undefined}
      style={{
        height: 22,
        paddingLeft: 7,
        paddingRight: 7,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        borderRadius: 5,
        position: "relative",
        backgroundColor: open ? colors.switcherSelection : "#00000000",
      }}
    >
      {extra.icon?.kind === "glyph" && <Svg markup={extra.icon.markup} size={SIZE} color={colors.text} />}
      {extra.icon?.kind === "image" && <Image source={extra.icon.path} style={{ width: SIZE, height: SIZE }} />}
      {extra.icon === null && extra.label === undefined && (
        // Nothing to draw (an icon no theme has): its name's first letter, so it can still be found and clicked.
        <View
          style={{ width: SIZE, height: SIZE, borderRadius: 4, borderWidth: 1.5, borderColor: colors.text, alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ fontSize: 10, fontWeight: "bold", color: colors.text }}>{[...extra.title][0]?.toUpperCase() ?? "?"}</Text>
        </View>
      )}
      {extra.label !== undefined && (
        <Text numberOfLines={1} style={{ fontSize: 12, color: colors.text }}>
          {extra.label}
        </Text>
      )}
      {extra.attention && (
        <View
          testID={`extra-attention:${extra.key}`}
          style={{ position: "absolute", top: 2, right: 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.critical }}
        />
      )}
    </View>
  );
}
