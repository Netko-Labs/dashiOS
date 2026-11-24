/**
 * An on/off switch for a setting that acts the moment it changes (UI-10: a
 * yes or no that goes with an answer is a Checkbox). On is the one "on"
 * (CO-1). The window look is the Mac's pill, 38 × 22, its white knob at the
 * end; the panel look is Settings' and Control Center's, 46 × 28, whose
 * track shows as an outline while off. Held, it deepens; disabled, the
 * whole switch is dimmed (UI-4).
 */

import { View } from "@mirinjs/metal";
import { useContext } from "react";
import type { Look } from "./button.tsx";
import { ControlName } from "./control-name.ts";
import { useControlState } from "./control-state.tsx";
import { useControlColors } from "./panel/index.ts";
import { CLEAR, KNOB, onOf, pill, SHADOW, useColors } from "./theme/index.ts";

/** The window look: 38 × 22, an 18 knob 2 in. */
export const SWITCH = { width: 38, height: 22, knob: 18, inset: 2 } as const;
/** The panel look: 46 × 28, a 20 knob 4 in, an off track's outline 2. */
export const PANEL_SWITCH = { width: 46, height: 28, knob: 20, inset: 4, edge: 2 } as const;

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
  look?: Look;
}

export function Switch({ on, testID, onChange, disabled, focused, focusable = true, label, look = "window" }: SwitchProps) {
  const colors = useColors();
  const panel = useControlColors();
  const fromRow = useContext(ControlName);
  const name = label ?? fromRow;
  const state = useControlState({ disabled, focused });
  const enabled = onChange !== undefined && disabled !== true;
  const lit = onOf(colors);
  const onFill = state.pressed ? colors.selectionPressed : lit.on;
  const m = look === "panel" ? PANEL_SWITCH : SWITCH;
  const offEdge = look === "panel" && !on;
  const track = on ? onFill : look === "panel" ? (state.pressed ? panel.knobOff : CLEAR) : state.pressed ? colors.pressed : colors.track;
  const knob = look === "panel" ? (on ? lit.onInk : panel.muted) : KNOB;
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={focusable && enabled}
      accessibilityRole="switch"
      {...(name ? { accessibilityLabel: name } : {})}
      accessibilityState={{ checked: on, disabled: disabled === true }}
      {...(enabled ? { onPress: () => onChange?.(!on) } : {})}
      onPointer={state.onPointer}
      style={{
        width: m.width,
        height: m.height,
        flexShrink: 0,
        borderRadius: pill(m.height),
        // The outline takes its width from the inset, so the knob sits where it does when on.
        padding: offEdge ? m.inset - PANEL_SWITCH.edge : m.inset,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        backgroundColor: track,
        ...(offEdge ? { borderWidth: PANEL_SWITCH.edge, borderColor: panel.muted } : {}),
        opacity: state.opacity,
        focusRingColor: colors.focusRing,
      }}
    >
      <View
        style={{
          width: m.knob,
          height: m.knob,
          borderRadius: pill(m.knob),
          backgroundColor: knob,
          ...(look === "window" ? { shadow: SHADOW.sm } : {}),
        }}
      />
    </View>
  );
}
