/**
 * The one checkbox (UI-10): a yes or no that goes with a sheet's answer or a
 * list's pick (a Switch is for a setting that acts at once). A 16 box at
 * radius 4: off, a 1.5 edge on the field's ground; on, the one "on" with an
 * onAccent tick (D587). Its words 13 (12.5 in the panel look, Settings'
 * ticks), 8 after. One Tab stop; Space or a press toggles it. Held, the box
 * deepens; disabled, the whole of it is dimmed (UI-4).
 */

import { Svg, Text, View } from "@mirinjs/metal";
import type { Look } from "./button.tsx";
import { useControlState } from "./control-state.tsx";
import { CHECK } from "./glyphs.ts";
import { CLEAR, onOf, RADIUS, SPACE, TYPE, useColors, useSurface } from "./theme/index.ts";

/** Its measures (design.html "Checkbox"): the box, the tick, the edge, the room before the words, a row's height. */
export const CHECKBOX = { box: 16, tick: 12, edge: 1.5, gap: SPACE.m, height: 26 } as const;

export interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID: string;
  disabled?: boolean;
  /** Keyboard focus is on it (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
  look?: Look;
}

export function Checkbox({ label, checked, onChange, testID, disabled, focused, look = "window" }: CheckboxProps) {
  const colors = useColors();
  const surface = useSurface();
  const state = useControlState({ disabled, focused });
  const { on, onInk } = onOf(colors);
  const fill = checked ? (state.pressed ? colors.selectionPressed : on) : state.pressed ? colors.pressed : surface.field;
  return (
    <View
      testID={testID}
      data-focused={state.focused}
      focusable={!disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled: disabled === true }}
      onPress={disabled ? undefined : () => onChange(!checked)}
      onPointer={state.onPointer}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: CHECKBOX.gap,
        minHeight: CHECKBOX.height,
        borderRadius: RADIUS.row,
        opacity: state.opacity,
        focusRingColor: colors.focusRing,
      }}
    >
      <View
        testID={`${testID}:box`}
        style={{
          width: CHECKBOX.box,
          height: CHECKBOX.box,
          flexShrink: 0,
          borderRadius: RADIUS.check,
          borderWidth: checked ? 0 : CHECKBOX.edge,
          borderColor: checked ? CLEAR : colors.controlEdge,
          backgroundColor: fill,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Svg markup={CHECK} size={CHECKBOX.tick} color={onInk} />}
      </View>
      <Text numberOfLines={1} style={{ fontSize: look === "panel" ? TYPE.panel.body.size : TYPE.body.size, color: colors.text }}>
        {label}
      </Text>
    </View>
  );
}
