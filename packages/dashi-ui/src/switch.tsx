/**
 * An on/off switch, macOS style: a pill that takes the accent color when on,
 * with its knob at the end. Settings, Control Center's pages, and the
 * launcher's rows (a setting with state) all draw this one. Disabled, the
 * whole switch is dimmed (UI-4).
 */

import { View } from "@mirinjs/metal";
import { useContext } from "react";
import { ControlName } from "./control-name.ts";
import { useControlState } from "./control-state.tsx";
import { KNOB, useColors } from "./theme/index.ts";

export interface SwitchProps {
  on: boolean;
  testID: string;
  /** Without it the switch only shows its state (a launcher row, where Space flips it). */
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
  /** Tab reaches a switch that can be flipped (KB-1); `false` leaves it to the pointer. */
  focusable?: boolean;
  /** What it turns on, for screen readers and agents; by default the label of the `Row` it is in. */
  label?: string;
}

export function Switch({ on, testID, onChange, disabled, focused, focusable = true, label }: SwitchProps) {
  const colors = useColors();
  const fromRow = useContext(ControlName);
  const name = label ?? fromRow;
  const state = useControlState({ disabled, focused });
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={focusable && onChange !== undefined && !disabled}
      accessibilityRole="switch"
      {...(name ? { accessibilityLabel: name } : {})}
      accessibilityState={{ checked: on, disabled: disabled === true }}
      {...(onChange && !disabled ? { onPress: () => onChange(!on) } : {})}
      style={{
        width: 38,
        height: 22,
        padding: 2,
        borderRadius: 11,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        backgroundColor: on ? colors.selection : colors.track,
        opacity: state.opacity,
        focusRingColor: colors.focusRing,
      }}
    >
      <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: KNOB, shadow: "sm" }} />
    </View>
  );
}
