/**
 * A pop-up button (docs/design.html, UI-2): the chosen option and a chevron;
 * pressing it opens the options as a menu laid over it, the chosen one
 * ticked and sitting where the button is, as on the Mac. For picking one of
 * a long list, or one of unknown length: printers, paper sizes, file types,
 * apps, languages (2–4 short options are a `Segmented`, 2–6 in a settings row
 * are `Choices`). The menu is drawn in the window's top layer, so a group's
 * clipping or a sheet never cuts it, and it stays inside the window.
 */

import { type Bounds, createPortal, Svg, Text, View } from "@mirinjs/metal";
import { useRef, useState } from "react";
import { buttonLook } from "./button-look.ts";
import type { Choice } from "./choices.tsx";
import { useControlState } from "./control-state.tsx";
import { CHEVRON_UP_DOWN } from "./glyphs.ts";
import { MENU, type MenuRowKind, menuLabelLeft, rowTop } from "./menu-place.ts";
import { isSeparator, type MenuEntry, type MenuSeparator, PopupMenu, tidyEntries } from "./popup-menu.tsx";
import { StepKeys } from "./step-keys.tsx";
import { useColors } from "./theme/index.ts";
import { useWindowLayer } from "./tooltip.tsx";

/** An option, or a line between two groups of them. */
export type PopUpOption<T> = Choice<T> | MenuSeparator;

const isOption = <T,>(option: PopUpOption<T>): option is Choice<T> => !("type" in option);

/** How far left of the button the menu starts, so its labels line up with the button's (its edge, padding, a row's inset and the ticks' column, less the button's own 10 in). */
const MENU_INSET = menuLabelLeft(true) - 10;

/** The menu's top-left for a button at `anchor`: the chosen row over the button. */
export function popUpOrigin(anchor: Bounds, rows: readonly MenuRowKind[], chosen: number): { x: number; y: number } {
  return { x: Math.round(anchor.x - MENU_INSET), y: Math.round(anchor.y + (anchor.height - MENU.row) / 2 - rowTop(rows, Math.max(chosen, 0))) };
}

/**
 * The menu for a button at `anchor`: its rows as the menu draws them (a
 * separator first, last or doubled is not a row), and its top-left, worked
 * out from those same rows so the chosen one lands on the button.
 */
export function popUpMenuAt(anchor: Bounds, entries: readonly MenuEntry[]): { items: MenuEntry[]; x: number; y: number } {
  const items = tidyEntries(entries);
  const rows = items.map((entry): MenuRowKind => (isSeparator(entry) ? "separator" : "item"));
  const chosen = items.findIndex((entry) => !isSeparator(entry) && entry.checked === true);
  return { items, ...popUpOrigin(anchor, rows, chosen) };
}

/** The menu's least width for a button at `anchor`: from the button's left, less the ticks' room, to its right edge. */
export const popUpMenuWidth = (anchor: Bounds): number => Math.round(anchor.width) + MENU_INSET;

export interface PopUpButtonProps<T extends string | number> {
  options: ReadonlyArray<PopUpOption<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  /** Pixels; by default it fits the chosen label. */
  width?: number;
  /** Shown when `value` is none of the options. */
  placeholder?: string;
  /** A glyph before the label, muted (a folder for a folder's pop-up). */
  glyph?: string;
  disabled?: boolean;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
}

export function PopUpButton<T extends string | number>({
  options,
  value,
  onChange,
  testID,
  width,
  placeholder = "Choose…",
  glyph,
  disabled,
  focused,
}: PopUpButtonProps<T>) {
  const colors = useColors();
  const layer = useWindowLayer();
  const state = useControlState({ disabled, focused });
  const [open, setOpen] = useState<Bounds | null>(null);
  // Pointer presses carry the button's bounds; the last layout stands in for a key's.
  const laid = useRef<Bounds | null>(null);
  const openAt = (bounds: Bounds | undefined): void => setOpen(bounds ?? laid.current ?? { x: 0, y: 0, width: width ?? 0, height: 28 });
  const choices = options.filter(isOption);
  const chosen = choices.find((option) => option.value === value);
  const look = buttonLook(colors, "secondary", { pressed: state.pressed || open !== null });

  const entries: MenuEntry[] = options.map((option) =>
    isOption(option) ? { label: option.label, checked: option.value === value, onPress: () => option.value !== value && onChange(option.value) } : option,
  );
  const menu =
    open === null
      ? null
      : (() => {
          const at = popUpMenuAt(open, entries);
          const node = (
            <PopupMenu
              testID={`${testID}:menu`}
              x={at.x}
              y={at.y}
              items={at.items}
              flip={false}
              // Its right edge on the button's (wider only by the ticks' column it opens to the left), unless its rows need more.
              minWidth={popUpMenuWidth(open)}
              onClose={() => setOpen(null)}
            />
          );
          return layer === null ? node : createPortal(node, layer);
        })();

  return (
    <View
      testID={testID}
      data-focused={state.focused}
      onPress={disabled ? undefined : (event) => openAt(event.bounds)}
      onPointer={state.onPointer}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
      style={{
        ...(width !== undefined ? { width } : { maxWidth: 260 }),
        height: 28,
        flexShrink: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: 7,
        backgroundColor: look.fill,
        borderWidth: 1,
        borderColor: look.edge,
        hoverBackgroundColor: disabled ? look.fill : look.hover,
        opacity: state.opacity,
      }}
    >
      {glyph !== undefined && <Svg markup={glyph} size={14} color={colors.textMuted} />}
      <View style={{ ...(width !== undefined ? { flex: 1 } : {}), flexShrink: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: chosen ? colors.text : colors.textMuted }}>
          {chosen?.label ?? placeholder}
        </Text>
      </View>
      <Svg markup={CHEVRON_UP_DOWN} size={12} color={colors.textMuted} />
      {!disabled && (
        // Tab reaches it; ↑↓←→ step through the options, Space or Return opens the menu (KB-1).
        <StepKeys
          testID={testID}
          labels={choices.map((option) => option.label)}
          index={chosen === undefined ? -1 : choices.indexOf(chosen)}
          onStep={(at) => {
            const next = choices[at];
            if (next !== undefined && next.value !== value) onChange(next.value);
          }}
          onActivate={openAt}
          radius={7}
          ringColor={colors.focusRing}
        />
      )}
      {menu}
    </View>
  );
}
