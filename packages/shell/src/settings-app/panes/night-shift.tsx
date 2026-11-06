/**
 * Night Shift, a section of Displays: the switch (the same as Control Center's
 * tile), an optional schedule, and how warm the screens go. The schedule and
 * the warmth are settings.json `nightShift`, which night-shift.ts reads; with
 * a schedule the shell flips the switch at its edges.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useSettings } from "../hooks.ts";
import { clockLabel, clockText, DEFAULT_SCHEDULE, DEFAULT_WARMTH, describeWarmth, FROM_HOURS, scheduleOf, TO_HOURS, timeChoices, WARMTH } from "../night.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Setting, Slider } from "../ui.tsx";

export function NightShiftSection({ settings }: { settings: SettingsStore }) {
  const colors = useColors();
  const { nightShift } = useSettings(settings).data;
  const schedule = scheduleOf(nightShift.from, nightShift.to);
  const kelvin = nightShift.kelvin ?? DEFAULT_WARMTH;
  return (
    <>
      <Caption above>Night Shift</Caption>
      <Group testID="night-shift">
        <Setting id="displays/night-shift" control="night-switch" />
        <Setting
          id="displays/night-shift-schedule"
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
        </Setting>
        {schedule && (
          <>
            <Setting id="displays/night-shift-from">
              <Choices
                testID="night-from"
                value={clockText(schedule.from)}
                options={timeChoices(FROM_HOURS, schedule.from)}
                onChange={(from) => settings.patch("nightShift", { from })}
              />
            </Setting>
            <Setting id="displays/night-shift-to">
              <Choices
                testID="night-to"
                value={clockText(schedule.to)}
                options={timeChoices(TO_HOURS, schedule.to)}
                onChange={(to) => settings.patch("nightShift", { to })}
              />
            </Setting>
          </>
        )}
        <Setting id="displays/night-shift-warmth" detail={describeWarmth(kelvin)}>
          <View style={{ flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
            <Slider testID="night-warmth" value={kelvin} range={WARMTH} onCommit={(value) => settings.patch("nightShift", { kelvin: value })} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: 220 }}>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Warmer</Text>
              <Text style={{ fontSize: 10, color: colors.textMuted }}>Cooler</Text>
            </View>
          </View>
        </Setting>
      </Group>
      <Caption>Warmth shows the next time Night Shift turns on. A schedule needs this computer's clock to be right.</Caption>
    </>
  );
}
