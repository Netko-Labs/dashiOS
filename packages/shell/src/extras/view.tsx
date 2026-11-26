/**
 * An extra in the menu bar's status side (types.ts): its picture and label
 * in a pill like the status glyphs' own, in the bar or in "…"'s row
 * (bar-overflow.tsx). A click activates it or
 * opens its menu (`menuOnClick`); a right-click opens its menu. An extra
 * that asks for attention gets a dot, as a Dock icon does.
 */

import { CLEAR, Picture, pill, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useRef } from "react";
import { barWashes } from "../shared/glass/index.ts";
import type { MenuBarExtra } from "./types.ts";

/** Nothing to draw (an icon no theme has, a file the host cannot draw): the name's first letter, so it can still be found and clicked. */
function Letter({ title }: { title: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        width: SIZE,
        height: SIZE,
        borderRadius: RADIUS.check,
        borderWidth: 1.5,
        borderColor: colors.text,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.bold, color: colors.text }}>{[...title][0]?.toUpperCase() ?? "?"}</Text>
    </View>
  );
}

/** The picture's size in the bar: the status glyphs' own. */
const SIZE = 16;
/** A tile in "…"'s row. */
export const TILE = 36;
/** The signs on a row: the DEV badge's height (the panel's micro words on their line) and the attention dot. */
const SIGN = { badge: TYPE.panel.micro.line, dot: 6 } as const;

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
  const washes = barWashes(colors.text);
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
        paddingLeft: tile ? SPACE.m : SPACE.s,
        paddingRight: tile ? SPACE.m : SPACE.s,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: SPACE.xs,
        borderRadius: tile ? RADIUS.sheet : RADIUS.row,
        position: "relative",
        backgroundColor: open ? washes.open : tile ? colors.button : CLEAR,
        hoverBackgroundColor: open ? washes.open : tile ? colors.tileHover : washes.hover,
      }}
    >
      {extra.icon?.kind === "glyph" && <Svg markup={extra.icon.markup} size={SIZE} color={colors.text} />}
      {extra.icon?.kind === "image" && (
        // A file the host cannot draw: the letter, unless a label already says what this is.
        <Picture source={extra.icon.path} style={{ width: SIZE, height: SIZE }} fallback={extra.label === undefined ? <Letter title={extra.title} /> : null} />
      )}
      {extra.icon === null && extra.label === undefined && <Letter title={extra.title} />}
      {extra.label !== undefined && (
        <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, color: colors.text }}>
          {extra.label}
        </Text>
      )}
      {extra.dev && (
        // `dashi-applet dev`: a developer's applet, not one installed from the store.
        <View
          testID={`extra-dev:${extra.key}`}
          style={{
            height: SIGN.badge,
            paddingLeft: SPACE.xxs,
            paddingRight: SPACE.xxs,
            borderRadius: RADIUS.thumb,
            borderWidth: 1,
            borderColor: colors.textMuted,
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: TYPE.panel.micro.size, fontWeight: WEIGHT.bold, color: colors.textMuted }}>DEV</Text>
        </View>
      )}
      {extra.attention && (
        <View
          testID={`extra-attention:${extra.key}`}
          style={{ position: "absolute", top: 2, right: 3, width: SIGN.dot, height: SIGN.dot, borderRadius: pill(SIGN.dot), backgroundColor: colors.critical }}
        />
      )}
    </View>
  );
}
