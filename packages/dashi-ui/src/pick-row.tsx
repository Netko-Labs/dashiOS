/**
 * The pick row (UI-13): a row to pick one from in a sheet, a popover, a
 * suggestion list or an empty state (Open With, versions, recent files). 30
 * tall at radius 7, 8 in from its card; an icon 20 or a glyph 16, its words
 * 13, a muted 11 detail at its right (a tag: "Default"). Under the pointer
 * the button's wash; chosen, the one selection look with its bar (CO-9).
 * `PickList` makes its rows one Tab stop where ↑ and ↓ choose and Return
 * presses (KB-1).
 */

import { Image, Svg, Text, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { rowLook, SelectionBar } from "./selection.tsx";
import { OPACITY, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";

/** Its measures (design.html "Pick row"). */
export const PICK_ROW = { height: 30, inset: SPACE.m, icon: 20, glyph: 16, gap: SPACE.m } as const;

export interface PickRowProps {
  label: string;
  chosen: boolean;
  onPress: () => void;
  testID: string;
  /** An app's or a file's icon (a path or URL). */
  icon?: string;
  /** A glyph instead of an icon. */
  glyph?: string;
  /** Muted words at the row's right: "Default", a size, a date. */
  detail?: string;
  disabled?: boolean;
}

export function PickRow({ label, chosen, onPress, testID, icon, glyph, detail, disabled }: PickRowProps) {
  const colors = useColors();
  const look = rowLook(colors, chosen);
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="option"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ selected: chosen, disabled: disabled === true }}
      onPress={disabled ? undefined : onPress}
      style={{
        height: PICK_ROW.height,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: PICK_ROW.gap,
        paddingHorizontal: PICK_ROW.inset,
        borderRadius: RADIUS.control,
        position: "relative",
        backgroundColor: look.ground,
        hoverBackgroundColor: disabled ? look.ground : look.hover,
        ...(disabled ? { opacity: OPACITY.disabled } : {}),
        focusRingColor: colors.focusRing,
      }}
    >
      {chosen && <SelectionBar rowHeight={PICK_ROW.height} />}
      {icon !== undefined && <Image source={icon} style={{ width: PICK_ROW.icon, height: PICK_ROW.icon }} />}
      {icon === undefined && glyph !== undefined && <Svg markup={glyph} size={PICK_ROW.glyph} color={look.glyph} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, fontWeight: chosen ? WEIGHT.semibold : WEIGHT.regular, color: look.ink }}>
          {label}
        </Text>
      </View>
      {detail !== undefined && <Text style={{ fontSize: TYPE.caption.size, color: look.quiet }}>{detail}</Text>}
    </View>
  );
}

/**
 * Pick rows as one list: one Tab stop where ↑ and ↓ move the choice (it
 * follows the keyboard) and Return presses the row the keyboard is on, as a
 * press does: a row's `onPress` picks it once it is chosen (Open With's).
 */
export function PickList({ children, testID }: { children: ReactNode; testID: string }) {
  return (
    <View testID={testID} focusGroup selectsOnFocus accessibilityRole="listbox" style={{ flexDirection: "column", gap: SPACE.px }}>
      {children}
    </View>
  );
}
