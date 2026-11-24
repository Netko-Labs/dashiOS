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
import type { ButtonInks } from "./button-measures.ts";
import { useControlState } from "./control-state.tsx";
import { CLEAR, ON_AGENT, onOf, pill, useColors, useDark } from "./theme/index.ts";
import { inksButtonColors } from "./tinted-button.tsx";

/** Its sizes: the target and the glyph in it. */
export const GLYPH_BUTTON = {
  regular: { target: 24, glyph: 14 },
  small: { target: 18, glyph: 10 },
  large: { target: 28, glyph: 14 },
  inks: { target: 30, glyph: 13 },
  edge: 1,
} as const;

export interface GlyphButtonProps {
  /** A glyph from glyphs.ts (drawn in #000, tinted here). */
  glyph: string;
  /** What it does, for screen readers and agents ("Remove", "New Desktop"). */
  label: string;
  onPress: () => void;
  testID: string;
  /** The window look's sizes; the inks look is always 30. */
  size?: "regular" | "small" | "large";
  /** Filled as a button that goes ahead: `primary` in ink (Stop), `agent` in the agents' shiso (the conversation's Send). */
  tone?: "primary" | "agent";
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
  /** The widget area's look (CO-11): a hairline ring at rest, `filled` in the card's fill; never the accent. */
  look?: "window" | "inks";
  /** The inks look's colours: the card's (by default the Inks' paper and ink). */
  inks?: ButtonInks;
  /** Twice as wide as tall: the one round button that leads a row (a player's ▶). */
  wide?: boolean;
}

export function GlyphButton(props: GlyphButtonProps) {
  return props.look === "inks" ? <InksGlyphButton {...props} /> : <WindowGlyphButton {...props} />;
}

function WindowGlyphButton({
  glyph,
  label,
  onPress,
  testID,
  size = "regular",
  filled,
  quiet,
  on,
  tone,
  disabled,
  focusable = true,
  focused,
}: GlyphButtonProps) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  const m = GLYPH_BUTTON[size];
  const lit = onOf(colors);
  const toned = tone === "primary" ? { fill: colors.primary, ink: colors.onPrimary } : tone === "agent" ? { fill: colors.agent, ink: ON_AGENT } : null;
  const rest = toned ? toned.fill : on ? lit.on : filled ? colors.track : CLEAR;
  const ink = toned ? toned.ink : on ? lit.onInk : quiet ? colors.textMuted : colors.text;
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
        hoverBackgroundColor: disabled || on || toned ? rest : filled ? colors.checkbox : colors.button,
        opacity: state.opacity,
        focusRingColor: colors.focusRing,
      }}
    >
      <Svg markup={glyph} size={m.glyph} color={ink} />
    </View>
  );
}

/** The inks look: round, 30 (60 wide), a hairline ring at rest or the card's fill; the glyph in ink or on the fill. */
function InksGlyphButton({ glyph, label, onPress, testID, filled, disabled, focusable = true, focused, inks, wide }: GlyphButtonProps) {
  const { focusRing } = useColors();
  const dark = useDark();
  const c = inks ?? inksButtonColors(dark);
  const state = useControlState({ disabled, focused });
  const m = GLYPH_BUTTON.inks;
  const rest = filled ? c.fill : CLEAR;
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={focusable && !disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      onPress={disabled ? undefined : onPress}
      onPointer={state.onPointer}
      style={{
        width: wide ? 2 * m.target : m.target,
        height: m.target,
        flexShrink: 0,
        borderRadius: pill(m.target),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed ? c.edge : rest,
        hoverBackgroundColor: disabled || filled ? rest : c.edge,
        ...(filled ? {} : { borderWidth: GLYPH_BUTTON.edge, borderColor: c.edge }),
        opacity: state.opacity,
        focusRingColor: focusRing,
      }}
    >
      <Svg markup={glyph} size={m.glyph} color={filled ? c.onFill : c.ink} />
    </View>
  );
}
