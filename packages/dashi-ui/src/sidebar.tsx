/**
 * A sidebar row as System Settings draws it: an optional glyph tile, the
 * label, an optional count at the end; the chosen row sits on the accent.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { Tile } from "./controls.tsx";
import { useColors } from "./theme/index.ts";

export interface SidebarItemProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  /** A glyph on a tile of this color (Settings' panes). */
  tile?: { glyph: string; tint: string };
  /** A bare glyph in the text's color (a Files-style list). */
  glyph?: string;
  /** Quiet text at the end: a count. */
  badge?: string;
  /** A tighter row (28 high), for a list that must fit a window (Settings' eighteen panes). */
  compact?: boolean;
}

export function SidebarItem({ label, selected, onPress, testID, tile, glyph, badge, compact }: SidebarItemProps) {
  const colors = useColors();
  const ink = selected ? "#ffffff" : colors.text;
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: compact === true ? 28 : 32,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 8,
        borderRadius: 7,
        backgroundColor: selected ? colors.selection : "#00000000",
        hoverBackgroundColor: selected ? colors.selection : colors.button,
      }}
    >
      {tile && <Tile glyph={tile.glyph} tint={tile.tint} />}
      {glyph !== undefined && <Svg markup={glyph} size={16} color={selected ? "#ffffff" : colors.selection} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: selected ? "semibold" : "normal", color: ink }}>
          {label}
        </Text>
      </View>
      {badge !== undefined && <Text style={{ fontSize: 12, color: selected ? "#ffffffcc" : colors.textMuted }}>{badge}</Text>}
    </View>
  );
}
