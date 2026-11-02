/**
 * Night Shift, a section of Displays: the switch (the same as Control Center's
 * tile), an optional schedule, and how warm the screens go. The schedule and
 * the warmth are settings.json `nightShift`, which night-shift.ts reads; with
 * a schedule the shell flips the switch at its edges.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type FlagsStore, useFlags } from "../../control-center/flags.ts";
import { Switch } from "../../wifi/switch.tsx";
import { useSettings } from "../hooks.ts";
import { clockLabel, clockText, DEFAULT_SCHEDULE, DEFAULT_WARMTH, describeWarmth, FROM_HOURS, scheduleOf, TO_HOURS, timeChoices, WARMTH } from "../night.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Row, Slider } from "../ui.tsx";

export function NightShiftSection({ settings, flags }: { settings: SettingsStore; flags: FlagsStore }) {
  const colors = useColors();
  const { night } = useFlags(flags);
  const { nightShift } = useSettings(settings).data;
  const schedule = scheduleOf(nightShift.from, nightShift.to);
  const kelvin = nightShift.kelvin ?? DEFAULT_WARMTH;
  return (
    <>
      <Caption above>Night Shift</Caption>
      <Group testID="night-shift">
        <Row label="Night Shift" detail="Warms the colors of the screens, easier on the eyes in the evening.">
          <Switch testID="night-switch" on={night} onChange={(on) => flags.set({ night: on })} />
        </Row>
        <Row
          stack
          label="Schedule"
          detail={schedule ? `On from ${clockLabel(schedule.from)} to ${clockLabel(schedule.to)}, every day.` : "Night Shift only changes when you switch it."}
        >
          <Choices
            testID="night-schedule"
            value={schedule ? "custom" : "off"}
            options={[
              { value: "off", label: "Off" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(choice) => settings.patch("nightShift", choice === "custom" ? { ...DEFAULT_SCHEDULE } : { from: undefined, to: undefined })}
          />
        </Row>
        {schedule && (
          <>
            <Row stack label="From">
              <Choices
                testID="night-from"
                value={clockText(schedule.from)}
                options={timeChoices(FROM_HOURS, schedule.from)}
                onChange={(from) => settings.patch("nightShift", { from })}
              />
            </Row>
            <Row stack label="To">
              <Choices
                testID="night-to"
                value={clockText(schedule.to)}
                options={timeChoices(TO_HOURS, schedule.to)}
                onChange={(to) => settings.patch("nightShift", { to })}
              />
            </Row>
          </>
        )}
        <Row label="Warmth" detail={describeWarmth(kelvin)}>
          <View style={{ flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <Slider testID="night-warmth" value={kelvin} range={WARMTH} onCommit={(value) => settings.patch("nightShift", { kelvin: value })} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: 220 }}>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Warmer</Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Cooler</Text>
            </View>
          </View>
        </Row>
      </Group>
      <Caption>Warmth shows the next time Night Shift turns on. A schedule needs this computer's clock to be right.</Caption>
    </>
  );
}
