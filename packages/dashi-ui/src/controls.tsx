/**
 * Dashi's controls, in the way the Mac's look: grouped cards of rows (a label,
 * then the control), choices as pills, buttons, and glyph tiles. They paint
 * with the shell's live palette, so Dark Mode repaints them. System Settings
 * builds its panes from them (settings-app/ui.tsx adds the page and the
 * slider), and so do the first-party apps (apps/kit).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { Children, Fragment, type ReactNode } from "react";
import { buttonLook } from "./button-look.ts";
import { useControlState } from "./control-state.tsx";
import { Shortcut } from "./shortcut.tsx";
import { useColors, useSurface } from "./theme/index.ts";

/**
 * A sentence pulled 8 closer to the group above it. It keeps the default
 * `flexShrink`: mirin's layout (its vendored taffy 0.9) makes a column
 * shorter by the margin times the child's height when a child with
 * `flexShrink: 0` has a negative margin, and a scroll view that holds the
 * column loses its range. A column as tall as its content never shrinks it.
 */
const TUCK = { marginTop: -8 } as const;

/** A heading over a group, or a sentence under it (`TUCK`); `keys` draws a shortcut after it ("⌃❖Q"). */
export function Caption({ children, above, keys }: { children: string; above?: boolean; keys?: string }) {
  const colors = useColors();
  const text = <Text style={{ fontSize: above ? 12 : 11, fontWeight: above ? "semibold" : "normal", color: colors.textMuted }}>{children}</Text>;
  // A shortcut is drawn after the text, not typed into it: text fonts don't reliably carry ❖.
  return (
    // With keys, a row the width of its content, so the shortcut sits right after the text (keep such captions to one line).
    <View
      style={{
        ...(above ? { flexShrink: 0, marginTop: 4 } : TUCK),
        paddingHorizontal: 4,
        ...(keys ? { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4 } : {}),
      }}
    >
      {text}
      {keys ? <Shortcut keys={keys} color={colors.textMuted} size={11} /> : null}
    </View>
  );
}

/** A card of rows, a hairline between them. */
export function Group({
  children,
  testID,
  wash,
}: {
  children: ReactNode;
  testID?: string /** A color laid over the whole card (Settings lights a card a link lands on). */;
  wash?: string;
}) {
  const colors = useColors();
  const surface = useSurface();
  const rows = Children.toArray(children);
  return (
    <View
      testID={testID}
      style={{
        flexShrink: 0,
        flexDirection: "column",
        borderRadius: 10,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        overflow: "hidden",
      }}
    >
      {/* Always there, so lighting the card never remounts its rows. */}
      <View style={{ flexDirection: "column", backgroundColor: wash ?? "#00000000" }}>
        {rows.map((row, index) => (
          // The rows of a group never reorder.
          <Fragment key={index}>
            {index > 0 && <View style={{ height: 1, marginLeft: 12, backgroundColor: colors.separator }} />}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

/** A label (and a quieter line under it) with a control at the end; `stack` puts the control under the label. */
export function Row({ label, detail, children, stack, testID }: { label: string; detail?: string; children?: ReactNode; stack?: boolean; testID?: string }) {
  const colors = useColors();
  const labels = (
    <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
      <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
      {detail !== undefined && <Text style={{ fontSize: 11, color: colors.textMuted }}>{detail}</Text>}
    </View>
  );
  if (stack) {
    return (
      <View testID={testID} style={{ flexDirection: "column", gap: 10, padding: 12 }}>
        {labels}
        {children}
      </View>
    );
  }
  return (
    <View testID={testID} style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 12, paddingVertical: 8 }}>
      {labels}
      {children}
    </View>
  );
}

/** A line of explanation or of nothing to show. */
export function Note({ children, testID }: { children: string; testID?: string }) {
  const colors = useColors();
  return (
    <View testID={testID} style={{ padding: 16, alignItems: "center" }}>
      <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>{children}</Text>
    </View>
  );
}

export interface Choice<T> {
  value: T;
  label: string;
}

/** Choices as pills in a row that wraps; the chosen one takes the accent. */
export function Choices<T extends string | number>({
  options,
  value,
  onChange,
  testID,
  disabled,
  focused,
}: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
  /** Keyboard focus is in the row (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
}) {
  const state = useControlState({ disabled, focused });
  return (
    // One Tab stop; the arrows move between the pills, Space or Return picks one (KB-1).
    <View
      testID={testID}
      focusGroup
      accessibilityRole="group"
      data-focused={state.focused}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, opacity: state.opacity }}
    >
      {options.map((option) => (
        <Pill
          key={String(option.value)}
          label={option.label}
          chosen={option.value === value}
          testID={`${testID}:${option.value}`}
          onPress={disabled ? undefined : () => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/** One choice pill: kombu when chosen, the quiet fill otherwise; deeper while held. */
function Pill({ label, chosen, testID, onPress }: { label: string; chosen: boolean; testID: string; onPress?: () => void }) {
  const colors = useColors();
  const state = useControlState({ disabled: onPress === undefined });
  const look = buttonLook(colors, chosen ? "primary" : "secondary", { pressed: state.pressed });
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      onPointer={state.onPointer}
      style={{
        height: 26,
        paddingHorizontal: 12,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: look.fill,
        hoverBackgroundColor: onPress ? look.hover : look.fill,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: look.weight, color: look.ink }}>{label}</Text>
    </View>
  );
}

/**
 * A push button: kombu for the one that goes ahead, ume (`danger`) for one
 * that can't be taken back. A secondary button has an edge, so it reads
 * against any ground; `isDefault` rings it in kombu: it is what Enter presses
 * (a destructive sheet's Cancel). It deepens under the pointer and more while
 * held; disabled, the whole button is dimmed (UI-4, button-look.ts).
 */
export function Button({
  label,
  onPress,
  testID,
  primary,
  danger,
  disabled,
  isDefault,
  focused,
  focusable = true,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  isDefault?: boolean;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
  /** Tab reaches it (KB-1); `false` leaves it to the pointer. A disabled button never takes the keyboard. */
  focusable?: boolean;
}) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  const look = buttonLook(colors, danger ? "danger" : primary ? "primary" : "secondary", { pressed: state.pressed, isDefault });
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={focusable && !disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      onPress={disabled ? undefined : onPress}
      onPointer={state.onPointer}
      style={{
        minWidth: 84,
        height: 28,
        paddingHorizontal: 14,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: look.fill,
        borderWidth: look.edgeWidth,
        borderColor: look.edge,
        hoverBackgroundColor: disabled ? look.fill : look.hover,
        opacity: state.opacity,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: look.weight, color: look.ink }}>{label}</Text>
    </View>
  );
}

/** A glyph on a rounded tile of its color: the sidebar's icons and the About logo. */
export function Tile({ glyph, tint, size = 22 }: { glyph: string; tint: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.27, alignItems: "center", justifyContent: "center", backgroundColor: tint }}>
      <Svg markup={glyph} size={Math.round(size * 0.64)} color="#ffffff" />
    </View>
  );
}
