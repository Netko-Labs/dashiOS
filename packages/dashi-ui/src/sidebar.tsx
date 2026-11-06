/**
 * A sidebar row as System Settings draws it: an optional glyph tile, the
 * label, an optional count at the end; the chosen row takes the one
 * selection look (selection.tsx): the kombu wash and its 3 px bar.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { Tile } from "./controls.tsx";
import { rowLook, SelectionBar } from "./selection.tsx";
import { useColors } from "./theme/index.ts";

export interface SidebarItemProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  /** A glyph on a tile of this color (Settings' panes). */
  tile?: { glyph: string; tint: string };
  /** A bare glyph in muted ink, ink when selected (a Files-style list). */
  glyph?: string;
  /** Quiet text at the end: a count. */
  badge?: string;
  /** A tighter row (28 high), for a list that must fit a window (Settings' eighteen panes). */
  compact?: boolean;
}

export function SidebarItem({ label, selected, onPress, testID, tile, glyph, badge, compact }: SidebarItemProps) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  const height = compact === true ? 28 : 32;
  return (
    <View
      testID={testID}
      focusable
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        height,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 8,
        borderRadius: 7,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
        focusRingColor: colors.focusRing,
      }}
    >
      {selected && <SelectionBar rowHeight={height} />}
      {tile && <Tile glyph={tile.glyph} tint={tile.tint} />}
      {/* Kombu marks the selected row only (its wash and bar); a glyph is ink on it and muted at rest (CO-2). */}
      {glyph !== undefined && <Svg markup={glyph} size={16} color={look.glyph} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: selected ? "semibold" : "normal", color: look.ink }}>
          {label}
        </Text>
      </View>
      {badge !== undefined && <Text style={{ fontSize: 12, color: look.quiet }}>{badge}</Text>}
    </View>
  );
}
