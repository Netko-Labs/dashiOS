/**
 * A sidebar row as System Settings draws it: an optional glyph tile, the
 * label, an optional count at the end, and an optional accessory (a row's
 * own action: an eject, a check, a More button); the chosen row takes the
 * one selection look (selection.tsx): the wash and its 3 px bar.
 *
 * In the rail (LA-5), a sidebar folded to 56 when the content would get less
 * than its least, the row is its glyph centred in a 32 row, named by a
 * tooltip "‹Name› — ‹count›"; its accessory shows only in the full sidebar.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { rowLook, SelectionBar } from "./selection.tsx";
import { RADIUS, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";
import { TILE_SIZE, Tile } from "./tile.tsx";
import { useTooltip } from "./tooltip.tsx";

export interface SidebarItemProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
  /** A glyph on a tile of this color (Settings' panes). */
  tile?: { glyph: string; tint: string };
  /** A bare glyph in muted ink, ink when selected (a Files-style list). */
  glyph?: string;
  /**
   * The bare glyph centred in a tile's width (22), for a list that mixes
   * glyph rows with tile rows (Software's places over its categories), so
   * every label starts at one edge.
   */
  tileColumn?: boolean;
  /** Quiet text at the end: a count. */
  badge?: string;
  /** A tighter row (28 high), for a list that must fit a window (Settings' eighteen panes). */
  compact?: boolean;
  /** The rail (LA-5): the glyph alone, centred, its name in a tooltip. */
  rail?: boolean;
  /** The row's own action at its end, in the full sidebar only (a focusable control of its own). */
  accessory?: ReactNode;
}

/** A sidebar row's height (LA-1); a compact one is 28. Apps that draw their own rows (Files' places, Notes' New folder) take it too. */
export const SIDEBAR_ROW_HEIGHT = 32;
const COMPACT_ROW_HEIGHT = 28;
/** The rail's width (LA-5), and a row's gap and inset. */
export const SIDEBAR = { rail: 56, gap: 9, inset: SPACE.m, glyph: 16 } as const;

/** A rail row's tooltip: its name, and its count after " — ". */
export const railTip = (label: string, badge?: string): string => (badge ? `${label} — ${badge}` : label);

export function SidebarItem({ label, selected, onPress, testID, tile, glyph, tileColumn, badge, compact, rail, accessory }: SidebarItemProps) {
  const colors = useColors();
  const look = rowLook(colors, selected);
  const height = compact === true ? COMPACT_ROW_HEIGHT : SIDEBAR_ROW_HEIGHT;
  const tip = useTooltip(rail ? railTip(label, badge) : undefined);
  const mark = tile ? (
    <Tile glyph={tile.glyph} tint={tile.tint} />
  ) : glyph !== undefined ? (
    tileColumn === true && !rail ? (
      <View style={{ width: TILE_SIZE, flexShrink: 0, alignItems: "center" }}>
        <Svg markup={glyph} size={SIDEBAR.glyph} color={look.glyph} />
      </View>
    ) : (
      <Svg markup={glyph} size={SIDEBAR.glyph} color={look.glyph} />
    )
  ) : null;
  return (
    <View
      testID={testID}
      focusable
      accessibilityRole="tab"
      accessibilityLabel={railTip(label, badge)}
      accessibilityState={{ selected }}
      onPress={() => {
        tip.hide();
        onPress();
      }}
      onHoverChange={tip.onHoverChange}
      style={{
        height,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        ...(rail ? { justifyContent: "center" } : {}),
        gap: SIDEBAR.gap,
        paddingHorizontal: SIDEBAR.inset,
        borderRadius: RADIUS.control,
        backgroundColor: look.ground,
        hoverBackgroundColor: look.hover,
        focusRingColor: colors.focusRing,
      }}
    >
      {selected && <SelectionBar rowHeight={height} />}
      {/* The accent marks the selected row only (its wash and bar); a glyph is ink on it and muted at rest (CO-2). */}
      {mark}
      {!rail && (
        // The count is smaller than the name: the two share a baseline (centered boxes left the count high).
        <View testID={`${testID}:words`} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: SIDEBAR.gap }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: selected ? WEIGHT.semibold : WEIGHT.regular, color: look.ink }}>
              {label}
            </Text>
          </View>
          {badge !== undefined && <Text style={{ fontSize: TYPE.secondary.size, color: look.quiet }}>{badge}</Text>}
        </View>
      )}
      {!rail && accessory !== undefined && (
        <View testID={`${testID}:accessory`} style={{ flexShrink: 0, flexDirection: "row", alignItems: "center" }}>
          {accessory}
        </View>
      )}
      {tip.node}
    </View>
  );
}
