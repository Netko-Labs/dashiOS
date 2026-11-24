/**
 * An on/off switch for a setting that acts the moment it changes (UI-10: a
 * yes or no that goes with an answer is a Checkbox). On is the one "on"
 * (CO-1). The window look is the Mac's pill, 38 × 22, its white knob at the
 * end; the panel look is Settings' and Control Center's, 46 × 28, whose
 * track shows as an outline while off. Held, it deepens; disabled, the
 * whole switch is dimmed (UI-4). The inks look is the widget area's, which
 * the accent never paints (CO-2, CO-11): 36 × 20, on in the Inks' ink with
 * a paper knob, off on the hairline.
 */

import { View } from "@mirinjs/metal";
import { useContext } from "react";
import type { Look } from "./button.tsx";
import { ControlName } from "./control-name.ts";
import { useControlState } from "./control-state.tsx";
import { useControlColors } from "./panel/index.ts";
import { CLEAR, INK_PAPER, INK_TEXT, KNOB, onOf, pill, SHADOW, useColors, useDark } from "./theme/index.ts";

/** The window look: 38 × 22, an 18 knob 2 in. */
export const SWITCH = { width: 38, height: 22, knob: 18, inset: 2 } as const;
/** The panel look: 46 × 28, a 20 knob 4 in, an off track's outline 2. */
export const PANEL_SWITCH = { width: 46, height: 28, knob: 20, inset: 4, edge: 2 } as const;
/** The inks look (the widget area): 36 × 20, a 16 knob 2 in. */
export const INKS_SWITCH = { width: 36, height: 20, knob: 16, inset: 2 } as const;

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
  /** The window look, the panel look, or the widget area's inks. */
  look?: Look | "inks";
  /** The panel look on a lit tile (Control Center's page header, on): on, its track the on ink and its knob the on colour. */
  lit?: boolean;
}

export function Switch({ on, testID, onChange, disabled, focused, focusable = true, label, look = "window", lit = false }: SwitchProps) {
  const colors = useColors();
  const panel = useControlColors();
  const fromRow = useContext(ControlName);
  const name = label ?? fromRow;
  const state = useControlState({ disabled, focused });
  const enabled = onChange !== undefined && disabled !== true;
  const mode = useDark() ? "dark" : "light";
  const shade = onOf(colors);
  const onFill = state.pressed ? colors.selectionPressed : shade.on;
  const m = look === "panel" ? PANEL_SWITCH : look === "inks" ? INKS_SWITCH : SWITCH;
  const offEdge = look === "panel" && !on;
  const onLit = lit && on;
  const panelTrack = state.pressed ? panel.knobOff : CLEAR;
  const windowTrack = state.pressed ? colors.pressed : colors.track;
  const track =
    look === "inks" ? (on ? INK_TEXT[mode].ink : INK_TEXT[mode].hairline) : onLit ? shade.onInk : on ? onFill : look === "panel" ? panelTrack : windowTrack;
  const knob = look === "inks" ? INK_PAPER[mode] : onLit ? shade.on : look === "panel" ? (on ? shade.onInk : panel.muted) : KNOB;
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
