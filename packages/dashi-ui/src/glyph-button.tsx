/**
 * A button that is one glyph (IC-3, UI-8): a notification's ✕, the
 * overview's × and +, a toolbar's tool. Round, the glyph in ink (muted with
 * `quiet`), nothing under it at rest unless `filled`, a wash under the
 * pointer and a deeper one while held; disabled, dimmed whole (UI-4). One
 * that turns something on (the capture toolbar's microphone) shows `on` in
 * the one "on" (CO-1). Named for screen readers by `label`, since it has no
 * words; Tab reaches it.
 */

import { Svg, View } from "@mirinjs/metal";
import { useControlState } from "./control-state.tsx";
import { CLEAR, onOf, pill, useColors } from "./theme/index.ts";

/** Its sizes: the target and the glyph in it. */
export const GLYPH_BUTTON = { regular: { target: 24, glyph: 14 }, small: { target: 18, glyph: 10 } } as const;

export interface GlyphButtonProps {
  /** A glyph from glyphs.ts (drawn in #000, tinted here). */
  glyph: string;
  /** What it does, for screen readers and agents ("Remove", "New Desktop"). */
  label: string;
  onPress: () => void;
  testID: string;
  size?: keyof typeof GLYPH_BUTTON;
  /** A disc under it at rest (the track's grey): a ✕ on a card. */
  filled?: boolean;
  /** The glyph muted: a secondary tool. */
  quiet?: boolean;
  /** It turns something on, and it is on: the one "on" under its ink (a toggle; screen readers hear it checked). */
  on?: boolean;
  disabled?: boolean;
  focusable?: boolean;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows). */
  focused?: boolean;
}

export function GlyphButton({ glyph, label, onPress, testID, size = "regular", filled, quiet, on, disabled, focusable = true, focused }: GlyphButtonProps) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  const m = GLYPH_BUTTON[size];
  const lit = onOf(colors);
  const rest = on ? lit.on : filled ? colors.track : CLEAR;
  const ink = on ? lit.onInk : quiet ? colors.textMuted : colors.text;
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={focusable && !disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true, ...(on !== undefined ? { checked: on } : {}) }}
      onPress={disabled ? undefined : onPress}
      onPointer={state.onPointer}
      style={{
        width: m.target,
        height: m.target,
        flexShrink: 0,
        borderRadius: pill(m.target),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed ? (on ? colors.selectionPressed : colors.pressed) : rest,
        hoverBackgroundColor: disabled || on ? rest : filled ? colors.checkbox : colors.button,
        opacity: state.opacity,
        focusRingColor: colors.focusRing,
      }}
    >
      <Svg markup={glyph} size={m.glyph} color={ink} />
    </View>
  );
}
