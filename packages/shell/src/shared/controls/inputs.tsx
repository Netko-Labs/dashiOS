/**
 * Settings' controls in Control Center's language (docs/design.html,
 * "Settings"): a switch whose track shows when it is off and turns Dashi
 * green when on, segmented pills whose chosen one is green with the tighter
 * corner (it tightens on the spring, as a tile does), and push buttons as
 * pills: ink for the one that goes ahead (green only ever means "on"),
 * outlined otherwise. Every one takes the keyboard with the purple ring;
 * disabled, the whole control is at 40%.
 */

import { DISABLED_OPACITY, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useSpring } from "./motion.ts";
import { useControlColors } from "./palette.ts";

/** The switch: 46 × 28, a 20 knob 4 in. */
export const SWITCH = { width: 46, height: 28, knob: 20, inset: 4 } as const;

export interface ControlSwitchProps {
  on: boolean;
  testID: string;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  /** Tab reaches a switch that can be flipped; `false` leaves it to the pointer. */
  focusable?: boolean;
}

export function ControlSwitch({ on, testID, onChange, disabled, focusable = true }: ControlSwitchProps) {
  const colors = useControlColors();
  const enabled = onChange !== undefined && disabled !== true;
  return (
    <View
      testID={testID}
      focusable={focusable && enabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: disabled === true }}
      {...(enabled ? { onPress: () => onChange?.(!on) } : {})}
      style={{
        width: SWITCH.width,
        height: SWITCH.height,
        flexShrink: 0,
        borderRadius: SWITCH.height / 2,
        padding: on ? SWITCH.inset : SWITCH.inset - 2,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: on ? "flex-end" : "flex-start",
        backgroundColor: on ? colors.on : "#00000000",
        borderWidth: on ? 0 : 2,
        borderColor: colors.muted,
        opacity: disabled ? DISABLED_OPACITY : 1,
        focusRingColor: colors.focus,
      }}
    >
      <View style={{ width: SWITCH.knob, height: SWITCH.knob, borderRadius: SWITCH.knob / 2, backgroundColor: on ? colors.onInk : colors.muted }} />
    </View>
  );
}

/** The pills' track and pills: 4 in, 4 apart; a pill 32 tall, radius 16, 11 when chosen. */
export const SEGMENTED = { padding: 4, gap: 4, height: 32, radius: 16, chosenRadius: 11 } as const;

function SegmentPill({ label, chosen, testID, onPress }: { label: string; chosen: boolean; testID: string; onPress?: () => void }) {
  const colors = useControlColors();
  const radius = useSpring(chosen ? SEGMENTED.chosenRadius : SEGMENTED.radius);
  return (
    <View
      testID={testID}
      focusable={onPress !== undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: chosen }}
      {...(onPress ? { onPress } : {})}
      style={{
        height: SEGMENTED.height,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: radius,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: chosen ? colors.on : "#00000000",
        hoverBackgroundColor: chosen ? colors.on : colors.knobOff,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: "semibold", color: chosen ? colors.onInk : colors.offInk }}>
        {label}
      </Text>
    </View>
  );
}

export interface SegmentedProps<T extends string | number> {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  testID: string;
  disabled?: boolean;
}

/** Choices as segmented pills: one Tab stop, the arrows move between them, Space or Return picks one. */
export function Segmented<T extends string | number>({ options, value, onChange, testID, disabled }: SegmentedProps<T>) {
  const colors = useControlColors();
  return (
    <View
      testID={testID}
      focusGroup
      accessibilityRole="group"
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        flexShrink: 1,
        gap: SEGMENTED.gap,
        padding: SEGMENTED.padding,
        borderRadius: SEGMENTED.radius + SEGMENTED.padding,
        backgroundColor: colors.line,
        opacity: disabled ? DISABLED_OPACITY : 1,
        focusRingColor: colors.focus,
      }}
    >
      {options.map((option) => (
        <SegmentPill
          key={String(option.value)}
          label={option.label}
          chosen={option.value === value}
          testID={`${testID}:${option.value}`}
          {...(disabled ? {} : { onPress: () => onChange(option.value) })}
        />
      ))}
    </View>
  );
}

export type PillTone = "plain" | "ink" | "danger";

/** A push button as a pill: 36 tall (28 `small`), ink for the one that goes ahead, an outline otherwise, ume words for one that can't be undone. */
export function PillButton({
  label,
  onPress,
  testID,
  tone = "plain",
  disabled,
  small,
  focusable = true,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  tone?: PillTone;
  disabled?: boolean;
  small?: boolean;
  focusable?: boolean;
}) {
  const colors = useControlColors();
  const { critical } = useColors();
  const height = small ? 28 : 36;
  const ink = tone === "ink" ? colors.window : tone === "danger" ? critical : colors.text;
  return (
    <View
      testID={testID}
      focusable={focusable && !disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      {...(disabled ? {} : { onPress })}
      style={{
        height,
        minWidth: small ? 0 : 72,
        flexShrink: 0,
        paddingLeft: small ? 12 : 14,
        paddingRight: small ? 12 : 14,
        borderRadius: height / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: tone === "ink" ? colors.text : "#00000000",
        hoverBackgroundColor: tone === "ink" ? colors.text : colors.knobOff,
        borderWidth: tone === "ink" ? 0 : 1.5,
        borderColor: colors.line,
        opacity: disabled ? DISABLED_OPACITY : 1,
        focusRingColor: colors.focus,
      }}
    >
      <Text numberOfLines={1} style={{ fontSize: small ? 12 : 12.5, fontWeight: "semibold", color: ink }}>
        {label}
      </Text>
    </View>
  );
}

/** A link in words ("Other…"): underlined ink, not a choice of its own. */
export function TextLink({ label, onPress, testID }: { label: string; onPress: () => void; testID: string }) {
  const colors = useControlColors();
  return (
    <View testID={testID} focusable accessibilityRole="link" onPress={onPress} style={{ flexShrink: 0, borderRadius: 4, focusRingColor: colors.focus }}>
      <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: colors.text, textDecorationLine: "underline" }}>{label}</Text>
    </View>
  );
}
