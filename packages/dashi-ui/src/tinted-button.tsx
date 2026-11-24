/**
 * The push button's two tinted looks (UI-8, TK-2): drawn in the colours the
 * surface under them gives, since neither may wear the accent or the app's
 * palette.
 *
 * - The inks look (the widget area, CO-11): a pill on the card's paper under
 *   its hairline, ink words; the one that goes ahead is the card's fill under
 *   its own words. Without `inks` it takes the Inks' paper and ink by the mode.
 * - The capsule look (the capsule and its card, pill-v2): a pill outlined in
 *   the persona's words, the one that goes ahead filled; the keys that do the
 *   same follow the words, soft.
 *
 * Both are focusable, named, dimmed whole while disabled (UI-4), and their
 * ground steps while held.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { BUTTON, type ButtonInks, type ButtonProps } from "./button-measures.ts";
import { useControlState } from "./control-state.tsx";
import { Shortcut } from "./shortcut.tsx";
import { CLEAR, INK_PAPER, INK_TEXT, pill, SPACE, TYPE, useColors, useDark, WEIGHT } from "./theme/index.ts";

/** The Inks' own colours for a button, by the mode: paper and ink. */
export function inksButtonColors(dark: boolean): ButtonInks {
  const text = INK_TEXT[dark ? "dark" : "light"];
  const paper = INK_PAPER[dark ? "dark" : "light"];
  return { ink: text.ink, ground: paper, edge: text.hairline, fill: text.ink, onFill: paper, soft: text.secondary };
}

interface Drawn {
  height: number;
  inset: number;
  edge: number;
  glyph: number;
  words: number;
  /** At rest, held, and under the pointer. */
  rest: string;
  held: string;
  hover: string;
  ink: string;
  outline: string | null;
}

/** One tinted button, drawn from what its look decided. */
function Tinted({
  label,
  onPress,
  testID,
  disabled,
  fill,
  focused,
  focusable = true,
  accessibilityLabel,
  glyph,
  keys,
  inks,
  drawn,
}: Omit<ButtonProps, "look"> & { drawn: (pressed: boolean) => Drawn }) {
  const { focusRing } = useColors();
  const state = useControlState({ disabled, focused });
  const d = drawn(state.pressed);
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={focusable && !disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: disabled === true }}
      onPress={disabled ? undefined : onPress}
      onPointer={state.onPointer}
      style={{
        ...(fill ? { flex: 1 } : {}),
        height: d.height,
        flexShrink: 0,
        flexDirection: "row",
        gap: SPACE.xs,
        paddingHorizontal: d.inset,
        borderRadius: pill(d.height),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed ? d.held : d.rest,
        hoverBackgroundColor: disabled ? d.rest : d.hover,
        ...(d.outline ? { borderWidth: d.edge, borderColor: d.outline } : {}),
        opacity: state.opacity,
        focusRingColor: focusRing,
      }}
    >
      {glyph && <Svg markup={glyph} size={d.glyph} color={d.ink} />}
      <Text numberOfLines={1} style={{ fontSize: d.words, fontWeight: WEIGHT.semibold, color: d.ink, textAlign: "center" }}>
        {label}
      </Text>
      {keys && <Shortcut keys={keys} color={inks?.soft ?? d.ink} size={d.words - 1} />}
    </View>
  );
}

/** The inks look (the widget area): paper under a hairline, ink words; the one that goes ahead the card's fill. */
export function InksButton(props: ButtonProps) {
  const dark = useDark();
  const c = props.inks ?? inksButtonColors(dark);
  const small = props.size === "small";
  const m = BUTTON.inks;
  const look = (pressed: boolean): Drawn => ({
    height: small ? m.smallHeight : m.height,
    inset: small ? m.smallInset : m.inset,
    edge: m.edge,
    glyph: m.glyph,
    words: small ? TYPE.panel.detail.size : TYPE.secondary.size,
    rest: props.primary ? c.fill : c.ground,
    held: c.edge,
    hover: props.primary ? c.fill : c.edge,
    ink: props.primary && !pressed ? c.onFill : c.ink,
    outline: props.primary ? null : c.edge,
  });
  return <Tinted {...props} drawn={look} />;
}

/** The capsule look (pill-v2): outlined in the persona's words, the yes filled; the line's buttons small. */
export function CapsuleButton(props: ButtonProps) {
  const c = props.inks ?? inksButtonColors(false);
  const small = props.size === "small";
  const m = BUTTON.capsule;
  const look = (): Drawn => ({
    height: small ? m.smallHeight : m.height,
    inset: small ? m.smallInset : m.inset,
    edge: m.edge,
    glyph: m.glyph,
    words: small ? TYPE.panel.detail.size : TYPE.secondary.size,
    rest: props.primary ? c.fill : CLEAR,
    held: props.primary ? c.fill : c.edge,
    hover: props.primary ? c.fill : c.edge,
    ink: props.primary ? c.onFill : c.ink,
    outline: props.primary ? null : c.ink,
  });
  return <Tinted {...props} drawn={look} />;
}
