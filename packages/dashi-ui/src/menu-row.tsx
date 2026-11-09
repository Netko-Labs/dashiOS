/**
 * One menu row and one menu separator, drawn the same in every menu: a
 * window's (`MenuList`, `PopupMenu`, a pop-up button's) and the menu bar's,
 * the Dock's and a status item's (the shell's dropdown). The measures are
 * `MENU`'s (menu-place.ts, docs/design.html "Menu"): a 24 row at radius 5,
 * 8 in at each side; in a menu with a tick, every row keeps the tick's 12
 * column and 6 after it, so all labels share one edge; the shortcut keeps
 * at least 24 from its label and sits on the row's right edge, muted, its
 * key in a 14 column so the modifiers above and below end on one edge; a
 * separator is a hairline 8 in, with 4 above and below.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { createContext, useContext } from "react";
import { CHECK } from "./glyphs.ts";
import { MENU } from "./menu-place.ts";
import { Shortcut } from "./shortcut.tsx";
import { useColors } from "./theme/index.ts";

/** How a lit row is drawn: its fill, the words on it, and its shortcut's ink. */
export interface MenuHighlight {
  fill: string;
  ink: string;
  keysInk: string;
}

/**
 * Menus inside it light their rows with this instead of kombu under white:
 * Settings and Control Center give their own "on" green and its ink, so a
 * menu opened from a row of pills lights in the chosen pill's green
 * (docs/design.html CO-9). Portals keep it: a menu in the window's layer
 * still reads it.
 */
export const MenuHighlightContext = createContext<MenuHighlight | null>(null);

/** The lit row's look: the surface's (`MenuHighlightContext`), else kombu under white. */
export function menuHighlight(own: MenuHighlight | null, selection: string): MenuHighlight {
  return own ?? { fill: selection, ink: "#ffffff", keysInk: "#ffffffcc" };
}

export interface MenuRowProps {
  label: string;
  testID: string;
  /** The shortcut, only shown ("⇧❖Z"), drawn by `Shortcut` (fonts lack ❖). */
  keys?: string;
  /** The menu keeps a tick column: some row in it can be ticked. */
  ticks: boolean;
  checked?: boolean;
  disabled?: boolean;
  /** Under the pointer or the arrow keys: kombu, white ink (or the surface's `MenuHighlightContext`). */
  lit: boolean;
  /** Tab can reach it (a window's menu; the menu bar's take the keys themselves). */
  focusable?: boolean;
  onHoverChange?: (over: boolean) => void;
  onPress?: () => void;
}

export function MenuRow({ label, testID, keys, ticks, checked, disabled = false, lit, focusable = false, onHoverChange, onPress }: MenuRowProps) {
  const colors = useColors();
  const look = menuHighlight(useContext(MenuHighlightContext), colors.selection);
  const shown = lit && !disabled;
  const ink = disabled ? colors.textDisabled : shown ? look.ink : colors.text;
  const keysInk = disabled ? colors.textDisabled : shown ? look.keysInk : colors.textMuted;
  return (
    <View
      testID={testID}
      focusable={focusable && !disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled, selected: shown, ...(checked === undefined ? {} : { checked }) }}
      {...(onHoverChange && !disabled ? { onHoverChange } : {})}
      {...(onPress ? { onPress } : {})}
      style={{
        height: MENU.row,
        // In a menu too tall for the window the rows scroll, never squeeze.
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: MENU.keysGap,
        paddingHorizontal: MENU.inset,
        borderRadius: MENU.rowRadius,
        backgroundColor: shown ? look.fill : "#00000000",
        focusRingColor: colors.focusRing,
      }}
    >
      {/* The label gives way (an ellipsis) at the menu's widest; the shortcut never leaves the row. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: MENU.tickGap, flexShrink: 1, minWidth: 0 }}>
        {ticks && (
          <View testID={`${testID}:tick`} style={{ width: MENU.tick, flexShrink: 0, alignItems: "center" }}>
            {checked === true && <Svg markup={CHECK} size={MENU.tick} color={ink} />}
          </View>
        )}
        <View style={{ flexShrink: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
            {label}
          </Text>
        </View>
      </View>
      {keys !== undefined && (
        <View style={{ flexShrink: 0 }}>
          <Shortcut keys={keys} size={12} color={keysInk} keyColumn={MENU.keyColumn} />
        </View>
      )}
    </View>
  );
}

/** The line between two groups of rows: a hairline 8 in, 4 above and below (9 in all). */
export function MenuLine() {
  const colors = useColors();
  return (
    <View style={{ height: MENU.separator, flexShrink: 0, justifyContent: "center", paddingHorizontal: MENU.inset }}>
      <View style={{ height: 1, backgroundColor: colors.separator }} />
    </View>
  );
}
