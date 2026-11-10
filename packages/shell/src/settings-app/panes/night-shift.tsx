/**
 * Night Shift, a section of Displays (its switch, the same as Control
 * Center's tile, is on the display's card): an optional schedule, and how
 * warm the screens go. The schedule and
 * the warmth are settings.json `nightShift`, which night-shift.ts reads; with
 * a schedule the shell flips the switch at its edges.
 */

import { NIGHT_SHIFT } from "../../shared/settings/knob-glyphs.ts";
import { useSettings } from "../hooks.ts";
import { clockLabel, clockText, DEFAULT_SCHEDULE, DEFAULT_WARMTH, describeWarmth, FROM_HOURS, scheduleOf, TO_HOURS, timeChoices, WARMTH } from "../night.ts";
import type { SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Setting, Slider } from "../ui.tsx";

export function NightShiftSection({ settings }: { settings: SettingsStore }) {
  const { nightShift } = useSettings(settings).data;
  const schedule = scheduleOf(nightShift.from, nightShift.to);
  const kelvin = nightShift.kelvin ?? DEFAULT_WARMTH;
  return (
    <>
      <Caption above>Night Shift</Caption>
      <Group testID="night-shift">
        <Setting
          id="displays/night-shift-schedule"
          detail={schedule ? `On from ${clockLabel(schedule.from)} to ${clockLabel(schedule.to)}, every day.` : "Night Shift only changes when you switch it."}
          stack={false}
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
        <Setting id="displays/night-shift-warmth" detail="Left is warmer, right cooler.">
          <Slider
            testID="night-warmth"
            value={kelvin}
            range={WARMTH}
            glyph={NIGHT_SHIFT}
            format={describeWarmth}
            onCommit={(value) => settings.patch("nightShift", { kelvin: value })}
          />
        </Setting>
      </Group>
      <Caption>Warmth shows the next time Night Shift turns on. A schedule needs this computer's clock to be right.</Caption>
    </>
  );
}
