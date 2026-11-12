/**
 * A dropdown, the way macOS draws one: a panel, rows with the label on the
 * left and the shortcut on the right, thin separators, disabled rows
 * greyed, a check in the gutter for the chosen one. Its rows and measures
 * are every menu's (@dashi/ui `MenuRow`, `MENU`), so the menu bar's, the
 * Dock's and a window's menus look alike. The pointer or the arrow keys
 * highlight a row; a click, Return or Space chooses it, and from the menu
 * bar ← → go to the next menu (bar-keys.ts). It stays on its screen
 * (place.ts).
 */

import { MENU, MenuLine, MenuRow, menuHeight, type Size, useColors, useSurface } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import { useState } from "react";
import { isEnabled, stepHighlight } from "../model.ts";
import type { MenuEntry } from "../types.ts";
import { DROPDOWN, type DropdownAnchor, placeDropdown } from "./place.ts";

/**
 * A key in an open dropdown (GPUI's names): ↑ ↓ move the highlight, Return
 * or Space choose, ← → go to the bar's next menu (`side`), Esc closes.
 */
export function dropdownKey(
  key: string,
): { kind: "step"; direction: "up" | "down" } | { kind: "choose" } | { kind: "side"; toward: "left" | "right" } | { kind: "close" } | null {
  switch (key) {
    case "up":
    case "down":
      return { kind: "step", direction: key };
    case "enter":
    case "space":
      return { kind: "choose" };
    case "left":
    case "right":
      return { kind: "side", toward: key };
    case "escape":
      return { kind: "close" };
    default:
      return null;
  }
}

export function DropdownMenu<A>({
  entries,
  x,
  above,
  alignRight = false,
  room = { width: 0, height: 0 },
  fromKeys = false,
  onSide,
  onChoose,
  onClose,
}: {
  entries: readonly MenuEntry<A>[];
  /** The panel's left edge, in screen pixels (its center with `above`, its right edge with `alignRight`). */
  x: number;
  /** Ends at `x` instead of starting there: a status item's menu, which opens from the right of the bar. */
  alignRight?: boolean;
  /**
   * Opens upward instead of down from the menu bar, centered on `x`, with
   * its bottom edge this far above the screen's bottom edge (the Dock's menus).
   */
  above?: number;
  /** The popover surface's size (the screen under the bar), which the panel stays inside; 0 while not known. */
  room?: Size;
  /** Opened from the keyboard (the menu bar's ring): the first row it can choose is lit, as on a Mac. */
  fromKeys?: boolean;
  /** ← or →: the menu bar's next menu (menus/bar-keys.ts); a menu not from the bar has none. */
  onSide?: (toward: "left" | "right") => void;
  onChoose: (action: A) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  const [highlight, setHighlight] = useState<number | null>(() => (fromKeys ? stepHighlight(entries, null, "down") : null));
  // Its width as last drawn (its least until then), to keep it inside the screen.
  const [width, setWidth] = useState<number>(DROPDOWN.minWidth);
  const ticks = entries.some((entry) => entry.kind === "item" && entry.checked !== undefined);
  const choose = () => {
    const entry = highlight === null ? undefined : entries[highlight];
    if (entry && isEnabled(entry) && entry.kind === "item" && entry.action) onChoose(entry.action);
  };
  const anchor: DropdownAnchor = above !== undefined ? { kind: "above", x, bottom: above } : alignRight ? { kind: "end", x } : { kind: "start", x };
  const height = menuHeight(entries.map((entry) => (entry.kind === "separator" ? "separator" : "item")));
  const place = placeDropdown(anchor, { width, height }, room);

  // Menus never reorder, so the index is the identity.
  const rows = entries.map((entry, index) =>
    entry.kind === "separator" ? (
      <MenuLine key={index} />
    ) : (
      <MenuRow
        key={index}
        testID={`menu-row:${entry.label}`}
        label={entry.label}
        {...(entry.keys ? { keys: entry.keys } : {})}
        ticks={ticks}
        {...(entry.checked !== undefined ? { checked: entry.checked } : {})}
        disabled={entry.action === null}
        lit={highlight === index}
        onHoverChange={(hovered) => setHighlight((current) => (hovered ? index : current === index ? null : current))}
        {...(entry.action !== null ? { onPress: () => entry.action !== null && onChoose(entry.action) } : {})}
      />
    ),
  );

  return (
    <View
      occlude
      testID="menu-panel"
      accessibilityRole="menu"
      onLayout={(bounds) => setWidth((now) => (Math.round(bounds.width) === now ? now : Math.round(bounds.width)))}
      onWindowKeyDown={(event) => {
        const command = dropdownKey(event.key);
        if (command?.kind === "close") onClose();
        else if (command?.kind === "step") setHighlight((current) => stepHighlight(entries, current, command.direction));
        else if (command?.kind === "choose") choose();
        else if (command?.kind === "side") onSide?.(command.toward);
      }}
      style={{
        position: "absolute",
        left: place.left,
        ...(place.top !== undefined ? { top: place.top } : {}),
        ...(place.bottom !== undefined ? { bottom: place.bottom } : {}),
        ...(place.maxHeight !== undefined ? { height: place.maxHeight } : {}),
        minWidth: DROPDOWN.minWidth,
        maxWidth: DROPDOWN.maxWidth,
        flexDirection: "column",
        borderRadius: MENU.radius,
        // Solid, as a window's menu: the window under it never ghosts through its rows (the menu's tint lies on the card ground).
        backgroundColor: surface.card,
        borderWidth: MENU.edge,
        borderColor: colors.menuEdge,
        shadow: "xl",
      }}
    >
      <View
        style={{
          ...(place.maxHeight !== undefined ? { flex: 1, minHeight: 0 } : {}),
          flexDirection: "column",
          padding: MENU.padding,
          borderRadius: MENU.radius - MENU.edge,
          backgroundColor: colors.menu,
        }}
      >
        {place.maxHeight === undefined ? (
          rows
        ) : (
          <ScrollView testID="menu-rows" style={{ flex: 1, flexDirection: "column" }}>
            {rows}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
