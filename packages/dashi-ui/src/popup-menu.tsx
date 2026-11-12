/**
 * A popup menu, drawn inside the window over everything like a sheet (sheet.tsx):
 * its entries, the card of rows, and the popup that places one at a point.
 */

import { ScrollView, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { KeySink } from "./key-sink.tsx";
import type { KeyInput } from "./keys.ts";
import { hungHeight, litAfter, MENU, type MenuRowKind, menuFits, menuHeight, menuMaxWidth, placeMenu, type Size } from "./menu-place.ts";
import { MenuLine, MenuRow } from "./menu-row.tsx";
import { useColors, useSurface } from "./theme/index.ts";

export interface MenuItem {
  type?: "item";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The shortcut, only shown, drawn by the shell's Shortcut (never typed into text: fonts lack ❖): "⌃C". */
  keys?: string;
  /** A tick before it (a view option that is on); `false` keeps the room for one. */
  checked?: boolean;
}

/** The line between two groups of a menu's items (PA-9). */
export interface MenuSeparator {
  type: "separator";
}

export const MENU_SEPARATOR: MenuSeparator = { type: "separator" };

/** A row of a menu: an item, or a separator. */
export type MenuEntry = MenuItem | MenuSeparator;

export const isSeparator = (entry: MenuEntry): entry is MenuSeparator => entry.type === "separator";

/** The rows as drawn: no separator first, last, or twice in a row, so a menu built from optional groups needs no care. */
export function tidyEntries(entries: readonly MenuEntry[]): MenuEntry[] {
  const kept = entries.filter((entry, index) => !isSeparator(entry) || (index > 0 && !isSeparator(entries[index - 1] as MenuEntry)));
  while (kept.length > 0 && isSeparator(kept[0] as MenuEntry)) kept.shift();
  while (kept.length > 0 && isSeparator(kept.at(-1) as MenuEntry)) kept.pop();
  return kept;
}

/**
 * A menu's card: its rows, separators between groups, the row under the
 * pointer in kombu. `PopupMenu` places one at a point; the gallery shows
 * one as it is.
 */
export function MenuList({
  items,
  onChoose,
  testID = "menu",
  minWidth = MENU.minWidth,
  maxWidth,
  lit,
  onLit,
  maxHeight,
}: {
  items: readonly MenuEntry[];
  /** A row was pressed (before its own `onPress`): a popup closes. */
  onChoose?: () => void;
  testID?: string;
  minWidth?: number;
  /** At most this wide, edge included: a longer label ends in an ellipsis (a folder's long name). */
  maxWidth?: number;
  /** The row drawn in kombu, by its place among the drawn rows, when the owner moves it with keys too (`PopupMenu`). */
  lit?: number | null;
  onLit?: (row: number | null) => void;
  /** At most this tall, padding and edge included: the rows scroll inside (`PopupMenu`, in a window shorter than the menu). */
  maxHeight?: number;
}) {
  const rows = tidyEntries(items);
  const ticks = rows.some((row) => !isSeparator(row) && row.checked !== undefined);
  const [ownLit, setOwnLit] = useState<number | null>(null);
  const hovered = lit === undefined ? ownLit : lit;
  const setHovered = (next: (now: number | null) => number | null): void => {
    const row = next(hovered);
    if (row === hovered) return;
    if (lit === undefined) setOwnLit(row);
    onLit?.(row);
  };
  // The rows of an open menu never reorder, so a row's place is its key.
  const list = rows.map((item, index) =>
    isSeparator(item) ? (
      <MenuLine key={index} />
    ) : (
      <MenuRow
        key={index}
        testID={`${testID}:${item.label}`}
        label={item.label}
        {...(item.keys !== undefined ? { keys: item.keys } : {})}
        ticks={ticks}
        {...(item.checked !== undefined ? { checked: item.checked } : {})}
        {...(item.disabled ? { disabled: true } : {})}
        lit={index === hovered}
        focusable
        onHoverChange={(over) => setHovered((now) => (over ? index : now === index ? null : now))}
        onPress={() => {
          onChoose?.();
          if (!item.disabled) item.onPress();
        }}
      />
    ),
  );
  return (
    <MenuCard testID={testID} minWidth={minWidth} maxWidth={maxWidth} maxHeight={maxHeight}>
      {list}
    </MenuCard>
  );
}

/** The card a menu's rows sit in; with a `maxHeight`, the rows scroll inside it. */
function MenuCard({
  testID,
  minWidth,
  maxWidth,
  maxHeight,
  children,
}: {
  testID: string;
  minWidth: number;
  maxWidth: number | undefined;
  maxHeight: number | undefined;
  children: ReactNode;
}) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      occlude
      testID={testID}
      // ↑ and ↓ move between its items, Return picks one.
      focusGroup
      accessibilityRole="menu"
      style={{
        minWidth,
        ...(maxWidth !== undefined ? { maxWidth } : {}),
        ...(maxHeight !== undefined ? { height: maxHeight } : {}),
        flexDirection: "column",
        borderRadius: MENU.radius,
        // Solid: a menu in a window is one layer over the work, and nothing blurs what is under it (the line's 40 pt digits read through glass).
        backgroundColor: surface.card,
        borderWidth: MENU.edge,
        borderColor: colors.menuEdge,
        shadow: "xl",
      }}
    >
      <View
        style={{
          ...(maxHeight !== undefined ? { flex: 1, minHeight: 0 } : {}),
          flexDirection: "column",
          padding: MENU.padding,
          borderRadius: MENU.radius - MENU.edge,
          backgroundColor: colors.menu,
        }}
      >
        {maxHeight === undefined ? (
          children
        ) : (
          <ScrollView testID={`${testID}:rows`} style={{ flex: 1, flexDirection: "column" }}>
            {children}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

/**
 * A menu at a point (a right-click, a pop-up button): a click on a row or
 * anywhere else closes it, and so does Esc. It stays inside the window,
 * flipped to the other side of the point when it would run off, or (with
 * `flip` false) slid back in (PA-9, menu-place.ts); one taller than the
 * window is as tall as the window allows, and its rows scroll; one wider
 * than the window is as wide as it allows, its labels ending in an
 * ellipsis. With
 * `anchor` "end", `x` is where its right edge goes (a menu hung from a
 * toolbar's "…" at the window's right), at the width it is drawn, and it
 * keeps under the button, its rows scrolling, while four rows fit there.
 */
export function PopupMenu({
  x,
  y,
  items,
  onClose,
  testID = "menu",
  minWidth = MENU.minWidth,
  maxWidth,
  flip = true,
  anchor = "start",
}: {
  x: number;
  y: number;
  items: readonly MenuEntry[];
  onClose: () => void;
  testID?: string;
  minWidth?: number;
  /** At most this wide: longer labels end in an ellipsis. */
  maxWidth?: number;
  flip?: boolean;
  anchor?: "start" | "end";
}) {
  const [room, setRoom] = useState<Size>({ width: 0, height: 0 });
  const [width, setWidth] = useState<number | null>(null);
  const rows = tidyEntries(items);
  // ↑ and ↓ light a row and Return picks it, before Tab moves into the menu; it opens on the ticked row (a pop-up button's choice).
  const [lit, setLit] = useState<number | null>(() => {
    const ticked = rows.findIndex((row) => !isSeparator(row) && row.checked === true);
    return ticked < 0 ? null : ticked;
  });
  const usable = rows.map((row) => !isSeparator(row) && row.disabled !== true);
  const onKey = (key: KeyInput): void => {
    if (key.kind === "escape") onClose();
    else if (key.kind === "up" || key.kind === "down") setLit((now) => litAfter(usable, now, key.kind === "up" ? -1 : 1));
    else if (key.kind === "enter" && lit !== null) {
      const row = rows[lit];
      if (row === undefined || isSeparator(row) || row.disabled) return;
      onClose();
      row.onPress();
    }
  };
  const kinds = rows.map((entry): MenuRowKind => (isSeparator(entry) ? "separator" : "item"));
  // Taller than the window, it fits the window and its rows scroll.
  const full = menuHeight(kinds);
  // Hung from a button, it keeps under the button and scrolls rather than slide up over it.
  const height = anchor === "end" ? hungHeight(full, y, room.height) : menuFits(full, room.height);
  const widest = menuMaxWidth(maxWidth, room.width);
  const drawn = width ?? minWidth;
  const at = placeMenu({ x: anchor === "end" ? x - drawn : x, y }, { width: drawn, height }, room, flip);
  return (
    <View
      occlude
      testID={`${testID}:away`}
      onPress={onClose}
      onLayout={(bounds) =>
        setRoom((now) => (now.width === bounds.width && now.height === bounds.height ? now : { width: bounds.width, height: bounds.height }))
      }
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }}
    >
      <KeySink testID={`${testID}:keys`} onKey={onKey} />
      <View
        // Tab moves into the menu and stays there while it is open; Esc closes it.
        focusTrap
        style={{ position: "absolute", left: at.x, top: at.y }}
        onLayout={(bounds) => setWidth((now) => (now === bounds.width ? now : bounds.width))}
      >
        <MenuList
          items={items}
          onChoose={onClose}
          testID={testID}
          minWidth={widest === undefined ? minWidth : Math.min(minWidth, widest)}
          {...(widest !== undefined ? { maxWidth: widest } : {})}
          lit={lit}
          onLit={setLit}
          {...(height < full ? { maxHeight: height } : {})}
        />
      </View>
    </View>
  );
}
