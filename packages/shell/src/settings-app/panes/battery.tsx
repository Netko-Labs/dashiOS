/**
 * Battery & Power: the battery (level, state, health, cycles), whether the
 * menu bar shows its percentage, its usage (the draw, the last day's charts,
 * insights, the apps using energy: battery-usage.tsx), the power mode (Automatic, Low Power,
 * Balanced, High Performance: power/modes/, with battery health and the processor on a laptop:
 * battery-laptop.tsx), what Dashi lowers on battery (the graphics card, the
 * refresh rate: on-battery.tsx), when the display turns off and
 * the computer sleeps, and what the lid and power button do. Parts that do not
 * apply are left out: a desktop has no battery, and a machine without the
 * daemon has no power modes. The lid is logind's configuration
 * (/etc/systemd/logind.conf), shown as it is.
 */

import { useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect } from "react";
import { batteryGlyph } from "../../glyphs.ts";
import { describeAction } from "../../power/policy.ts";
import { describeBattery } from "../../system/battery-details.ts";
import { useEnergy } from "../../system/energy.ts";
import { isProfileId, PROFILE_LABEL } from "../../system/profiles.ts";
import { BLANK_CHOICES, blankChoice, SLEEP_CHOICES, sleepChoice } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import type { PaneServices } from "../services.ts";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Setting } from "../ui.tsx";
import { BatteryHealthGroup, PowerModeGroup, ProcessorGroup } from "./battery-laptop.tsx";
import { BatteryUsage } from "./battery-usage.tsx";
import { OnBatteryGroup, type ShowPane } from "./on-battery.tsx";
import { Failure, Value } from "./parts.tsx";

const MODE_DETAIL = {
  "power-saver": "Quieter and cooler, with less performance. Battery lasts longer.",
  balanced: "Good performance without wasting power.",
  performance: "The most performance, with more heat, fan noise, and power use.",
} as const;

export function BatteryPane({ services, settings, show }: { services: PaneServices; settings: SettingsStore; show: ShowPane }) {
  const colors = useColors();
  const { energy } = services;
  const state = useEnergy(energy);
  const { idle } = useSettings(settings).data;
  useEffect(() => {
    energy.open();
    return () => energy.close();
  }, [energy]);
  const { battery, profiles, lid } = state;
  const blank = idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER;
  const sleep = idle.sleepAfterSeconds ?? 0;
  return (
    <Page title="Battery & Power">
      {battery && (
        <Group testID="battery-status">
          <Setting id="battery/battery" detail={describeBattery(battery)}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Svg
                markup={batteryGlyph(battery.percent, battery.state === "charging" ? true : battery.state === "discharging" ? false : "plugged")}
                width={30}
                height={15}
                color={battery.state === "discharging" && battery.percent <= 10 ? colors.batteryLow : colors.text}
              />
              <View testID="battery-percent">
                <Text style={{ fontSize: 15, fontWeight: "semibold", color: colors.text }}>{`${battery.percent}%`}</Text>
              </View>
            </View>
          </Setting>
          {battery.health !== null && (
            <Setting id="battery/battery-health">
              <Value testID="battery-health">{`${battery.health}%`}</Value>
            </Setting>
          )}
          {battery.cycles !== null && (
            <Setting id="battery/cycle-count">
              <Value testID="battery-cycles">{String(battery.cycles)}</Value>
            </Setting>
          )}
          <Setting id="battery/battery-percentage" control="battery-menubar" />
        </Group>
      )}
      {battery && services.battery && <BatteryUsage monitor={services.battery} />}
      {services.laptop && (
        <>
          <PowerModeGroup laptop={services.laptop} />
          <BatteryHealthGroup laptop={services.laptop} settings={settings} />
          <ProcessorGroup laptop={services.laptop} settings={settings} />
        </>
      )}
      {!services.laptop && profiles && (
        <>
          <Group testID="power-mode">
            <Setting id="battery/power-mode" detail={MODE_DETAIL[profiles.active]}>
              <Choices
                testID="power-profile"
                value={profiles.active}
                options={profiles.available.map((id) => ({ value: id, label: PROFILE_LABEL[id] }))}
                onChange={(id) => isProfileId(id) && void energy.setProfile(id)}
              />
            </Setting>
          </Group>
          {state.failed !== null && <Failure testID="power-failure">{`Couldn’t switch to ${PROFILE_LABEL[state.failed]}.`}</Failure>}
        </>
      )}
      {battery && <OnBatteryGroup laptop={services.laptop} refresh={services.refresh} show={show} />}
      <Caption above>Sleep</Caption>
      <Group testID="power-timers">
        <Setting id="battery/turn-display-off">
          <Choices
            testID="power-blank"
            options={BLANK_CHOICES}
            value={blankChoice(blank)}
            onChange={(blankAfterSeconds) => settings.patch("idle", { blankAfterSeconds })}
          />
        </Setting>
        <Setting id="battery/sleep-after">
          <Choices
            testID="power-sleep"
            options={SLEEP_CHOICES}
            value={sleepChoice(sleep)}
            onChange={(sleepAfterSeconds) => settings.patch("idle", { sleepAfterSeconds })}
          />
        </Setting>
      </Group>
      <Caption above>{lid ? "Lid and Power Button" : "Power Button"}</Caption>
      <Group testID="power-lid">
        {lid && (
          <>
            <Setting id="battery/lid">
              <Value testID="power-lid-battery">{describeAction(lid.lid)}</Value>
            </Setting>
            <Setting id="battery/lid-on-power">
              <Value testID="power-lid-power">{describeAction(lid.lidExternalPower)}</Value>
            </Setting>
            <Setting id="battery/lid-docked">
              <Value testID="power-lid-docked">{describeAction(lid.lidDocked)}</Value>
            </Setting>
          </>
        )}
        <Setting id="battery/power-button">
          <Value testID="power-button">Asks before shutting down</Value>
        </Setting>
      </Group>
      <Caption>
        {lid ? "The lid is set by the system (logind.conf), not per user. The power button always asks first." : "The power button always asks first."}
      </Caption>
    </Page>
  );
}
