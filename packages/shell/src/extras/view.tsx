/**
 * An extra in the menu bar's status side (types.ts): its picture and label
 * in a pill like the status glyphs' own, in the bar or in "…"'s row
 * (bar-overflow.tsx). A click activates it or
 * opens its menu (`menuOnClick`); a right-click opens its menu. An extra
 * that asks for attention gets a dot, as a Dock icon does.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, Image, Svg, Text, View } from "@mirinjs/metal";
import { useRef } from "react";
import type { MenuBarExtra } from "./types.ts";

/** The picture's size in the bar: the status glyphs' own. */
const SIZE = 16;
/** A tile in "…"'s row. */
export const TILE = 36;

export interface ExtraItemProps {
  extra: MenuBarExtra;
  /** Its menu is open: the pill is drawn pressed. */
  open: boolean;
  /** Open (or close) the extra's menu below it, its right edge at `right`. */
  onMenu(extra: MenuBarExtra, right: number): void;
  /** A click on an extra that activates, at (x, y) in the bar's pixels. */
  onActivate(extra: MenuBarExtra, x: number, y: number): void;
  /** Drawn as a tile in "…"'s row (bar-overflow.tsx) instead of a pill in the bar. */
  tile?: boolean;
  /** Named for a screen reader by its title, on a host that takes accessibility props. */
  accessible?: boolean;
}

export function ExtraItem({ extra, open, onMenu, onActivate, tile = false, accessible = false }: ExtraItemProps) {
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
      {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: extra.title, accessibilityState: { expanded: open } } : {})}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      onPress={({ bounds }) => press(bounds)}
      onContextMenu={extra.hasMenu ? () => onMenu(extra, boxOf().x + boxOf().width) : undefined}
      style={{
        height: tile ? TILE : 22,
        ...(tile ? { minWidth: TILE } : {}),
        paddingLeft: tile ? 9 : 7,
        paddingRight: tile ? 9 : 7,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        borderRadius: tile ? 12 : 5,
        position: "relative",
        backgroundColor: open ? colors.switcherSelection : tile ? colors.button : "#00000000",
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
      {extra.dev && (
        // `dashi-applet dev`: a developer's applet, not one installed from the store.
        <View
          testID={`extra-dev:${extra.key}`}
          style={{ height: 12, paddingLeft: 3, paddingRight: 3, borderRadius: 3, borderWidth: 1, borderColor: colors.textMuted, justifyContent: "center" }}
        >
          <Text style={{ fontSize: 8, fontWeight: "bold", color: colors.textMuted }}>DEV</Text>
        </View>
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
