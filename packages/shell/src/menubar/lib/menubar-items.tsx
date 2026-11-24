/**
 * The pills of the menu bar's rows: a menu's title, a status glyph and its
 * room to click, "…", and the keyboard's ring on each (menus/bar-keys.ts).
 * menubar.tsx lays out the titles, menubar-status.tsx the status side.
 */

import { CLEAR, MORE, pill, RADIUS, SPACE, useColors, useControlColors } from "@dashi/ui";
import { type Bounds, Svg, View } from "@mirinjs/metal";
import { type ReactNode, useRef } from "react";
import type { BarMenuId } from "../../menus/index.ts";
import { MORE_WIDTH } from "./menubar-fit.ts";

/** "…"'s name for a screen reader. */
export const MORE_LABEL = "More menu bar items";
/** The ume dot on "…" when a hidden item asks for attention. */
const ATTENTION_DOT = { size: 6 } as const;

/**
 * The keyboard's ring on a bar item (menus/bar-keys.ts): 2 px of the
 * focus purple on the item's own edge. The bar is one 28-tall row, so the
 * ring stays inside the item rather than 2 out (VS-1).
 */
export function BarRing({ radius }: { radius: number }) {
  const colors = useControlColors();
  return (
    <View
      testID="bar-ring"
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, borderRadius: radius, borderWidth: 2, borderColor: colors.focus }}
    />
  );
}

/**
 * One status glyph and the room around it to click. The glyphs sit side by
 * side with no gaps, so every pixel of the area is some item's.
 */
export function StatusItem({
  testID,
  onPress,
  open = false,
  label,
  children,
}: {
  testID: string;
  /** Its name for a screen reader, on a host that takes accessibility props (menubar.tsx `accessible`). */
  label?: string;
  /** With the item's bounds in the bar, when the event carries them. */
  onPress: (bounds?: Bounds) => void;
  /** Its own menu is open: the item's pill is drawn pressed. */
  open?: boolean;
  children: ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={({ bounds }) => onPress(bounds)}
      {...(label === undefined ? {} : { accessibilityRole: "button" as const, accessibilityLabel: label, accessibilityState: { expanded: open } })}
      style={{
        height: 22,
        paddingLeft: SPACE.s,
        paddingRight: SPACE.s,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: RADIUS.row,
        backgroundColor: open ? colors.openWash : CLEAR,
      }}
    >
      {children}
    </View>
  );
}

export function More({
  open,
  attention,
  focused,
  onPress,
  onBounds,
  accessible,
}: {
  open: boolean;
  attention: boolean;
  focused: boolean;
  onPress: (right: number) => void;
  onBounds: (bounds: Bounds) => void;
  accessible: boolean;
}) {
  const colors = useColors();
  const laid = useRef<Bounds | null>(null);
  return (
    <View
      testID="status-more"
      {...(accessible ? { accessibilityRole: "button" as const, accessibilityLabel: MORE_LABEL, accessibilityState: { expanded: open } } : {})}
      onLayout={(bounds) => {
        laid.current = bounds;
        onBounds(bounds);
      }}
      onPress={({ bounds }) => {
        const box = bounds ?? laid.current;
        onPress(box ? box.x + box.width : 0);
      }}
      style={{
        flexShrink: 0,
        width: MORE_WIDTH,
        height: MORE_WIDTH,
        borderRadius: MORE_WIDTH / 2,
        alignItems: "center",
        justifyContent: "center",
        position: "relative",
        backgroundColor: open ? colors.openWash : CLEAR,
      }}
    >
      <Svg markup={MORE} size={16} color={colors.text} />
      {focused && <BarRing radius={MORE_WIDTH / 2} />}
      {attention && (
        <View
          testID="status-more-attention"
          style={{
            position: "absolute",
            top: 1,
            right: 1,
            width: ATTENTION_DOT.size,
            height: ATTENTION_DOT.size,
            borderRadius: pill(ATTENTION_DOT.size),
            backgroundColor: colors.critical,
          }}
        />
      )}
    </View>
  );
}

/** A title's pill: padding to click, the wash behind it while its menu is open, and the keyboard's ring (menus/bar-keys.ts). */
export function Title({
  id,
  open,
  focused,
  label,
  onOpen,
  onHover,
  onBounds,
  children,
}: {
  id: BarMenuId;
  open: boolean;
  focused: boolean;
  /** Its name for a screen reader, on a host that takes accessibility props. */
  label?: string;
  onOpen: (x: number) => void;
  onHover: (x: number) => void;
  /** Where it is drawn, for opening it from the keyboard. */
  onBounds: (bounds: Bounds) => void;
  children: ReactNode;
}) {
  const colors = useColors();
  // Events carry the pill's bounds; the last layout stands in for one that does not.
  const laid = useRef<Bounds | null>(null);
  return (
    <View
      testID={`menu-title:${id}`}
      {...(label === undefined ? {} : { accessibilityRole: "button" as const, accessibilityLabel: label, accessibilityState: { expanded: open } })}
      onLayout={(bounds) => {
        laid.current = bounds;
        onBounds(bounds);
      }}
      onPress={({ bounds }) => onOpen((bounds ?? laid.current)?.x ?? 0)}
      onHoverChange={(hovered, bounds) => hovered && onHover((bounds ?? laid.current)?.x ?? 0)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        height: 22,
        paddingLeft: SPACE.gap,
        paddingRight: SPACE.gap,
        borderRadius: RADIUS.row,
        position: "relative",
        backgroundColor: open ? colors.openWash : CLEAR,
      }}
    >
      {children}
      {focused && <BarRing radius={5} />}
    </View>
  );
}
