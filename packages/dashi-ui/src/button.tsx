/**
 * The push button (UI-8): every pressable word in Dashi is this one. Ink
 * goes ahead (`primary`), ume destroys (`danger`), the rest are secondary
 * with an edge that reads on any ground; `isDefault` edges a secondary one
 * 2 px in ink: it is what Enter presses. Two sizes, 28 and a small 24 for
 * panels, banners and rows; `fill` takes its row's width. Two looks (TK-2):
 * the window look, radius 7, and the panel look, a pill (36, or 28 small)
 * outlined in the panel's hairline, as Settings and Control Center draw;
 * and the inks look of the widget area, where the accent never paints: a
 * pill on the Inks' paper under a hairline, ink words (the one that goes
 * ahead is ink under paper words).
 * Its fill steps under the pointer and more while held; disabled, the whole
 * button is dimmed (UI-4, button-look.ts).
 */

import { Text, View } from "@mirinjs/metal";
import { buttonLook } from "./button-look.ts";
import { useControlState } from "./control-state.tsx";
import { useControlColors } from "./panel/index.ts";
import { CLEAR, INK_PAPER, INK_TEXT, pill, RADIUS, SPACE, TYPE, useColors, useDark, WEIGHT } from "./theme/index.ts";

/** The button's measures (UI-8, design.html "Button"): heights, insets and least widths by look and size. */
export const BUTTON = {
  window: { height: 28, smallHeight: 24, inset: SPACE.button, smallInset: SPACE.inset, least: 84 },
  panel: { height: 36, smallHeight: 28, inset: SPACE.button, smallInset: SPACE.inset, least: 72, edge: 1.5 },
  inks: { height: 28, inset: SPACE.button, edge: 1 },
} as const;

export type ButtonSize = "regular" | "small";
export type Look = "window" | "panel";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  testID: string;
  primary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  isDefault?: boolean;
  /** `small`: 24 tall (28 in the panel look), 12 SemiBold. */
  size?: ButtonSize;
  /** Take the row's width (a sheet's stacked buttons, a card's one action). */
  fill?: boolean;
  /** The panel look: Settings, Control Center, the battery panel, the Installer; the inks look: the widget area. */
  look?: Look | "inks";
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
  /** Tab reaches it (KB-1); `false` leaves it to the pointer. A disabled button never takes the keyboard. */
  focusable?: boolean;
  /** What a screen reader says, when the words alone don't name it ("Delete “Groceries”"). */
  accessibilityLabel?: string;
}

export function Button(props: ButtonProps) {
  if (props.look === "inks") return <InksButton {...props} />;
  return props.look === "panel" ? <PanelButton {...props} /> : <WindowButton {...props} />;
}

function WindowButton({
  label,
  onPress,
  testID,
  primary,
  danger,
  disabled,
  isDefault,
  size = "regular",
  fill,
  focused,
  focusable = true,
  accessibilityLabel,
}: ButtonProps) {
  const colors = useColors();
  const state = useControlState({ disabled, focused });
  const look = buttonLook(colors, danger ? "danger" : primary ? "primary" : "secondary", { pressed: state.pressed, isDefault });
  const small = size === "small";
  const m = BUTTON.window;
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
        ...(fill ? { flex: 1 } : { minWidth: small ? 0 : m.least }),
        height: small ? m.smallHeight : m.height,
        paddingHorizontal: small ? m.smallInset : m.inset,
        borderRadius: RADIUS.control,
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
      <Text
        numberOfLines={1}
        style={{
          fontSize: small ? TYPE.secondary.size : TYPE.body.size,
          fontWeight: small ? WEIGHT.semibold : look.weight,
          color: look.ink,
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The panel look: a pill, ink for the one that goes ahead, outlined otherwise, ume words for one that can't be undone. */
function PanelButton({
  label,
  onPress,
  testID,
  primary,
  danger,
  disabled,
  size = "regular",
  fill,
  focused,
  focusable = true,
  accessibilityLabel,
}: ButtonProps) {
  const colors = useControlColors();
  const { critical, primaryHover, primaryPressed } = useColors();
  const state = useControlState({ disabled, focused });
  const small = size === "small";
  const m = BUTTON.panel;
  const height = small ? m.smallHeight : m.height;
  const ink = primary ? colors.window : danger ? critical : colors.text;
  const rest = primary ? colors.text : state.pressed ? colors.lit : CLEAR;
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
        ...(fill ? { flex: 1 } : { minWidth: small ? 0 : m.least }),
        height,
        flexShrink: 0,
        paddingHorizontal: small ? m.smallInset : m.inset,
        borderRadius: pill(height),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: primary && state.pressed ? primaryPressed : rest,
        hoverBackgroundColor: disabled ? rest : primary ? (state.pressed ? primaryPressed : primaryHover) : colors.knobOff,
        borderWidth: primary ? 0 : m.edge,
        borderColor: colors.line,
        opacity: state.opacity,
        focusRingColor: colors.focus,
      }}
    >
      <Text
        numberOfLines={1}
        style={{ fontSize: small ? TYPE.secondary.size : TYPE.panel.body.size, fontWeight: WEIGHT.semibold, color: ink, textAlign: "center" }}
      >
        {label}
      </Text>
    </View>
  );
}

/** The inks look (the widget area): a pill on paper under a hairline, ink words; one size. */
function InksButton({ label, onPress, testID, primary, disabled, fill, focused, focusable = true, accessibilityLabel }: ButtonProps) {
  const { focusRing } = useColors();
  const mode = useDark() ? "dark" : "light";
  const text = INK_TEXT[mode];
  const paper = INK_PAPER[mode];
  const state = useControlState({ disabled, focused });
  const m = BUTTON.inks;
  const rest = primary ? text.ink : paper;
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
        height: m.height,
        flexShrink: 0,
        paddingHorizontal: m.inset,
        borderRadius: pill(m.height),
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: state.pressed ? text.secondary : rest,
        hoverBackgroundColor: disabled ? rest : primary ? text.secondary : text.hairline,
        borderWidth: primary ? 0 : m.edge,
        borderColor: text.hairline,
        opacity: state.opacity,
        focusRingColor: focusRing,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: TYPE.secondary.size, fontWeight: WEIGHT.semibold, color: primary || state.pressed ? paper : text.ink }}>
        {label}
      </Text>
    </View>
  );
}
