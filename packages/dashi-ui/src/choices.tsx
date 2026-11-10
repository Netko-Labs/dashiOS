/** Choices: options as pills in a row that wraps (controls.tsx has the grouped rows they sit in). */

import { Text, View } from "@mirinjs/metal";
import { buttonLook } from "./button-look.ts";
import { useControlState } from "./control-state.tsx";
import { useColors } from "./theme/index.ts";

export interface Choice<T> {
  value: T;
  label: string;
}

/** Choices as pills in a row that wraps; the chosen one takes the accent. */
export function Choices<T extends string | number>({
  options,
  value,
  onChange,
  testID,
  disabled,
  focused,
}: {
  options: ReadonlyArray<Choice<T>>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
  /** Keyboard focus is in the row (`data-focused`, the gallery's state rows); real keyboard focus is Metal's ring (KB-2). */
  focused?: boolean;
}) {
  const state = useControlState({ disabled, focused });
  return (
    // One Tab stop; the arrows move between the pills, Space or Return picks one (KB-1).
    <View
      testID={testID}
      focusGroup
      accessibilityRole="group"
      data-focused={state.focused}
      style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, opacity: state.opacity }}
    >
      {options.map((option) => (
        <Pill
          key={String(option.value)}
          label={option.label}
          chosen={option.value === value}
          testID={`${testID}:${option.value}`}
          onPress={disabled ? undefined : () => onChange(option.value)}
        />
      ))}
    </View>
  );
}

/** One choice pill: kombu when chosen, the quiet fill otherwise; deeper while held. */
function Pill({ label, chosen, testID, onPress }: { label: string; chosen: boolean; testID: string; onPress?: () => void }) {
  const colors = useColors();
  const state = useControlState({ disabled: onPress === undefined });
  const look = buttonLook(colors, chosen ? "primary" : "secondary", { pressed: state.pressed });
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      onPress={onPress}
      onPointer={state.onPointer}
      style={{
        height: 26,
        paddingHorizontal: 12,
        borderRadius: 13,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: look.fill,
        hoverBackgroundColor: onPress ? look.hover : look.fill,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: look.weight, color: look.ink }}>{label}</Text>
    </View>
  );
}
