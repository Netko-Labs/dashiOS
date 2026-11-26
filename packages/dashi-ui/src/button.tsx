/**
 * The push button (UI-8): every pressable word in Dashi is this one. Ink
 * goes ahead (`primary`), ume destroys (`danger`), the rest are secondary
 * with an edge that reads on any ground; `isDefault` edges a secondary one
 * 2 px in ink: it is what Enter presses. Two sizes, 28 and a small 24 for
 * panels, banners and rows; `fill` takes its row's width. Two looks (TK-2):
 * the window look, radius 7, and the panel look, a pill (36, or 28 small)
 * outlined in the panel's hairline, as Settings and Control Center draw;
 * and two tinted looks drawn in colours their surface gives
 * (tinted-button.tsx): the widget area's inks and the capsule's persona.
 * Its fill steps under the pointer and more while held; disabled, the whole
 * button is dimmed (UI-4, button-look.ts).
 */

import { Text, View } from "@mirinjs/metal";
import { buttonLook } from "./button-look.ts";
import { BUTTON, type ButtonProps } from "./button-measures.ts";
import { useControlState } from "./control-state.tsx";
import { useControlColors } from "./panel/index.ts";
import { Shortcut } from "./shortcut.tsx";
import { CLEAR, pill, RADIUS, SPACE, TYPE, useColors, WEIGHT } from "./theme/index.ts";
import { CapsuleButton, InksButton } from "./tinted-button.tsx";

export function Button(props: ButtonProps) {
  if (props.look === "inks") return <InksButton {...props} />;
  if (props.look === "capsule") return <CapsuleButton {...props} />;
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
  keys,
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
        // Never narrower than its words: a short row (a toolbar at 1024 pt) gives way elsewhere, never "To…".
        ...(fill ? { flex: 1 } : { minWidth: small ? 0 : m.least, flexShrink: 0 }),
        height: small ? m.smallHeight : m.height,
        paddingHorizontal: small ? m.smallInset : m.inset,
        borderRadius: RADIUS.control,
        flexDirection: "row",
        gap: SPACE.s,
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
      {keys && <Shortcut keys={keys} color={look.ink} size={TYPE.caption.size} />}
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
        // On glass the outline is the glass control edge (CO-6).
        borderColor: colors.edge ?? colors.line,
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
