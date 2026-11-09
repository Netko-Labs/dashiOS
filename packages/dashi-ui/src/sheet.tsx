/**
 * Things that come over a window's content: a sheet (a card hung from the
 * top of the window that holds the window until it is answered; the confirm
 * sheet in confirm.tsx is built on it), a popup menu, and an empty state.
 * Metal has no child windows, so all of them are drawn inside the window,
 * over everything (pass them as `AppWindow`'s `overlay`).
 */

import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { KeySink } from "./key-sink.tsx";
import type { KeyInput } from "./keys.ts";
import { litAfter, MENU, type MenuRowKind, menuFits, menuHeight, menuMaxWidth, placeMenu, type Size } from "./menu-place.ts";
import { MenuLine, MenuRow } from "./menu-row.tsx";
import { useColors, useDark, useSurface } from "./theme/index.ts";
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

/**
 * What a sheet's scrim lays over the window: black, deeper in Dark, where the
 * ground is near black or black and a light wash would show nothing.
 */
export const SCRIM = { light: "#00000026", dark: "#0000008c" } as const;
/** The least room a sheet keeps from the window's sides and foot. */
export const SHEET_MARGIN = 16;

/**
 * The most a sheet's scrolling body may take in a window `windowHeight`
 * tall, besides `rest` (its buttons, gaps and other rows): the sheet hangs 8
 * under the toolbar (`top`, the title bar's inset), keeps SHEET_MARGIN from
 * the foot, and has 20 of padding and 1 of edge above and below. Taffy can't
 * size a scroll view by shrinking it, so a sheet caps its body with this.
 */
export function sheetBodyRoom(windowHeight: number, top: number, rest: number): number {
  return Math.max(96, Math.floor(windowHeight - (top + 8) - SHEET_MARGIN - 2 * 21 - rest));
}

/**
 * A sheet's card alone (radius 12, padding 20, the card ground, the `xl`
 * shadow): `Sheet` hangs one from a window; a surface of its own (the
 * shell's applet consent) shows one with no window to hang from.
 */
export function SheetCard({ children, testID, width = 380, marginTop = 0 }: { children: ReactNode; testID: string; width?: number; marginTop?: number }) {
  const colors = useColors();
  const surface = useSurface();
  return (
    <View
      testID={testID}
      occlude
      // Tab stays in the sheet while it is open; the window behind can't take the keyboard.
      focusTrap
      accessibilityRole="dialog"
      style={{
        width,
        marginTop,
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
  );
}

/** A sheet's width in a window `room` wide (0: not laid out yet): its own, or the window's less SHEET_MARGIN a side. */
export function sheetWidth(width: number, room: number): number {
  return room > 0 ? Math.max(0, Math.min(width, room - 2 * SHEET_MARGIN)) : width;
}

export function Sheet({ children, testID, width = 380, onCancel, onConfirm }: SheetProps) {
  const colors = useColors();
  const dark = useDark();
  const inset = useTitleBarInset();
  // The window's width, so a narrow one gets a narrower card: a number, so its content is measured at it.
  const [room, setRoom] = useState(0);
  return (
    // The card hangs under the toolbar, SHEET_MARGIN in from a narrow window's sides. A sheet that can
    // outgrow a short window caps its scrolling body (`sheetBodyRoom`), so its buttons stay in reach.
    <View
      occlude
      testID={`${testID}:scrim`}
      onLayout={(bounds) => {
        if (Math.round(bounds.width) !== room) setRoom(Math.round(bounds.width));
      }}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        flexDirection: "column",
        alignItems: "center",
        backgroundColor: dark ? SCRIM.dark : SCRIM.light,
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
      <SheetCard testID={testID} width={sheetWidth(width, room)} marginTop={Math.max(inset.top, 0) + 8}>
        {children}
      </SheetCard>
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
  const colors = useColors();
  const surface = useSurface();
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
          list
        ) : (
          <ScrollView testID={`${testID}:rows`} style={{ flex: 1, flexDirection: "column" }}>
            {list}
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
 * toolbar's "…" at the window's right), at the width it is drawn.
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
  const height = menuFits(full, room.height);
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
