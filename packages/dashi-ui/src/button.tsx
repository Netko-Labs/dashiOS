/** The push button (button-look.ts has its colors). */

import { Text, View } from "@mirinjs/metal";
import { buttonLook } from "./button-look.ts";
import { useControlState } from "./control-state.tsx";
import { useColors } from "./theme/index.ts";

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
