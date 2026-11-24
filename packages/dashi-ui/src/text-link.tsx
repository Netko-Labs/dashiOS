/**
 * A link in words (Q3, CO-1, SE-14): ink and underlined, never the accent.
 * "Other…" in a row of pills, a jump to another Settings pane by its name.
 * Focusable, with the link role and its words as its name.
 */

import { Text, View } from "@mirinjs/metal";
import type { Look } from "./button.tsx";
import { useControlState } from "./control-state.tsx";
import { useControlColors } from "./panel/index.ts";
import { RADIUS, TYPE, useColors, WEIGHT } from "./theme/index.ts";

export function TextLink({
  label,
  onPress,
  testID,
  disabled,
  look = "window",
  size = "regular",
}: {
  label: string;
  onPress: () => void;
  testID: string;
  disabled?: boolean;
  look?: Look;
  /** `small`: 11, for a link in a list of captions (a day's "3 more"). */
  size?: "regular" | "small";
}) {
  const colors = useColors();
  const panel = useControlColors();
  const state = useControlState({ disabled });
  const ink = look === "panel" ? panel.text : colors.text;
  return (
    <View
      testID={testID}
      focusable={!disabled}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled === true }}
      onPress={disabled ? undefined : onPress}
      onPointer={state.onPointer}
      style={{ flexShrink: 0, borderRadius: RADIUS.check, opacity: state.opacity, focusRingColor: colors.focusRing }}
    >
      <Text
        style={{
          fontSize: size === "small" ? TYPE.caption.size : look === "panel" ? TYPE.panel.body.size : TYPE.body.size,
          fontWeight: WEIGHT.semibold,
          color: state.pressed ? colors.textMuted : ink,
          textDecorationLine: "underline",
        }}
      >
        {label}
      </Text>
    </View>
  );
}
