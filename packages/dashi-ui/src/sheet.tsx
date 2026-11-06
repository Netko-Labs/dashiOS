/**
 * Things that come over a window's content: a sheet (a card hung from the
 * top of the window that holds the window until it is answered; the confirm
 * sheet in confirm.tsx is built on it), a popup menu, and an empty state.
 * Metal has no child windows, so all of them are drawn inside the window,
 * over everything (pass them as `AppWindow`'s `overlay`).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { CHECK } from "./glyphs.ts";
import { KeySink } from "./key-sink.tsx";
import { MENU, type MenuRowKind, menuHeight, placeMenu, type Size } from "./menu-place.ts";
import { Shortcut } from "./shortcut.tsx";
import { useColors, useSurface } from "./theme/index.ts";
import { useTitleBarInset } from "./window.tsx";

export interface SheetProps {
  children: ReactNode;
  testID: string;
  width?: number;
  /** Esc. */
  onCancel?: () => void;
  /** Enter, when the sheet has no field of its own to type into. */
  onConfirm?: () => void;
}

export function Sheet({ children, testID, width = 380, onCancel, onConfirm }: SheetProps) {
  const colors = useColors();
  const surface = useSurface();
  const inset = useTitleBarInset();
  return (
    <View
      occlude
      testID={`${testID}:scrim`}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        backgroundColor: "#00000026",
        focusRingColor: colors.focusRing,
      }}
    >
      {(onCancel || onConfirm) && (
        <KeySink
          testID={`${testID}:keys`}
          onKey={(key) => {
            if (key.kind === "escape") onCancel?.();
            else if (key.kind === "enter") onConfirm?.();
          }}
        />
      )}
      <View
        testID={testID}
        occlude
        // Tab stays in the sheet while it is open; the window behind can't take the keyboard.
        focusTrap
        accessibilityRole="dialog"
        style={{
          width,
          marginTop: Math.max(inset.top, 0) + 8,
          flexDirection: "column",
          gap: 10,
          padding: 20,
          borderRadius: 12,
          backgroundColor: surface.card,
          borderWidth: 1,
          borderColor: colors.separator,
          shadow: "xl",
        }}
      >
        {children}
      </View>
    </View>
  );
}

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
}: {
  items: readonly MenuEntry[];
  /** A row was pressed (before its own `onPress`): a popup closes. */
  onChoose?: () => void;
  testID?: string;
  minWidth?: number;
}) {
  const colors = useColors();
  const rows = tidyEntries(items);
  const ticks = rows.some((row) => !isSeparator(row) && row.checked !== undefined);
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <View
      occlude
      testID={testID}
      // ↑ and ↓ move between its items, Return picks one.
      focusGroup
      accessibilityRole="menu"
      style={{
        minWidth,
        flexDirection: "column",
        padding: MENU.padding,
        borderRadius: 9,
        backgroundColor: colors.menu,
        borderWidth: MENU.edge,
        borderColor: colors.separator,
        shadow: "xl",
      }}
    >
      {rows.map((item, index) => {
        if (isSeparator(item)) {
          return (
            // The rows of an open menu never reorder.
            <View key={index} style={{ height: MENU.separator, justifyContent: "center", paddingHorizontal: 8 }}>
              <View style={{ height: 1, backgroundColor: colors.separator }} />
            </View>
          );
        }
        const lit = !item.disabled && index === hovered;
        const ink = item.disabled ? colors.textDisabled : lit ? "#ffffff" : colors.text;
        return (
          <View
            key={index}
            testID={`${testID}:${item.label}`}
            focusable={!item.disabled}
            accessibilityRole="menuitem"
            onHoverChange={(over) => setHovered((now) => (over ? index : now === index ? null : now))}
            onPress={() => {
              onChoose?.();
              if (!item.disabled) item.onPress();
            }}
            style={{
              height: MENU.row,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 18,
              paddingHorizontal: 8,
              borderRadius: 5,
              backgroundColor: lit ? colors.selection : "#00000000",
              focusRingColor: colors.focusRing,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              {ticks && <View style={{ width: 12 }}>{item.checked && <Svg markup={CHECK} size={12} color={ink} />}</View>}
              <Text numberOfLines={1} style={{ fontSize: 13, color: ink }}>
                {item.label}
              </Text>
            </View>
            {item.keys !== undefined && (
              <Shortcut keys={item.keys} size={12} color={item.disabled ? colors.textDisabled : lit ? "#ffffffcc" : colors.textMuted} />
            )}
          </View>
        );
      })}
    </View>
  );
}

/**
 * A menu at a point (a right-click, a pop-up button): a click on a row or
 * anywhere else closes it, and so does Esc. It stays inside the window,
 * flipped to the other side of the point when it would run off, or (with
 * `flip` false) slid back in (PA-9, menu-place.ts).
 */
export function PopupMenu({
  x,
  y,
  items,
  onClose,
  testID = "menu",
  minWidth = MENU.minWidth,
  flip = true,
}: {
  x: number;
  y: number;
  items: readonly MenuEntry[];
  onClose: () => void;
  testID?: string;
  minWidth?: number;
  flip?: boolean;
}) {
  const [room, setRoom] = useState<Size>({ width: 0, height: 0 });
  const [width, setWidth] = useState<number | null>(null);
  const kinds = tidyEntries(items).map((entry): MenuRowKind => (isSeparator(entry) ? "separator" : "item"));
  const at = placeMenu({ x, y }, { width: width ?? minWidth, height: menuHeight(kinds) }, room, flip);
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
      <KeySink testID={`${testID}:keys`} onKey={(key) => key.kind === "escape" && onClose()} />
      <View
        // Tab moves into the menu and stays there while it is open; Esc closes it.
        focusTrap
        style={{ position: "absolute", left: at.x, top: at.y }}
        onLayout={(bounds) => setWidth((now) => (now === bounds.width ? now : bounds.width))}
      >
        <MenuList items={items} onChoose={onClose} testID={testID} minWidth={minWidth} />
      </View>
    </View>
  );
}

/** Nothing to show: a glyph, a line, a quieter line, maybe a way out. */
export function EmptyState({
  title,
  message,
  glyph,
  action,
  testID = "empty",
}: {
  title: string;
  message?: string;
  glyph?: string;
  action?: ReactNode;
  testID?: string;
}) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, padding: 24 }}>
      {glyph !== undefined && <Svg markup={glyph} size={36} color={colors.textDisabled} />}
      <Text style={{ fontSize: 15, fontWeight: "semibold", color: colors.textMuted, textAlign: "center" }}>{title}</Text>
      {message !== undefined && <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{message}</Text>}
      {action !== undefined && <View style={{ marginTop: 8 }}>{action}</View>}
    </View>
  );
}
