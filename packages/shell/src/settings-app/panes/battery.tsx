/**
 * Battery & Power: the battery (level, state, health, cycles), whether the
 * menu bar shows its percentage, the power mode (Low Power, Balanced, High
 * Performance, through power-profiles-daemon), when the display turns off and
 * the computer sleeps, and what the lid and power button do. Parts that do not
 * apply are left out: a desktop has no battery, and a machine without the
 * daemon has no power modes. The lid is logind's configuration
 * (/etc/systemd/logind.conf), shown as it is.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect } from "react";
import { batteryGlyph } from "../../glyphs.ts";
import { describeAction } from "../../power/policy.ts";
import { describeBattery } from "../../system/battery-details.ts";
import { useEnergy } from "../../system/energy.ts";
import { isProfileId, PROFILE_LABEL } from "../../system/profiles.ts";
import { useColors } from "@dashi/ui";
import { Switch } from "../../wifi/switch.tsx";
import { BLANK_CHOICES, blankChoice, SLEEP_CHOICES, sleepChoice } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import type { PaneServices } from "../services.ts";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Page, Row } from "../ui.tsx";
import { Failure, Value } from "./parts.tsx";

const MODE_DETAIL = {
  "power-saver": "Quieter and cooler, with less performance. Battery lasts longer.",
  balanced: "Good performance without wasting power.",
  performance: "The most performance, with more heat, fan noise, and power use.",
} as const;

export function BatteryPane({ services, settings }: { services: PaneServices; settings: SettingsStore }) {
  const colors = useColors();
  const { energy } = services;
  const state = useEnergy(energy);
  const { idle, menuBar } = useSettings(settings).data;
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
        <>
          <Group testID="battery-status">
            <Row label="Battery" detail={describeBattery(battery)}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Svg
                  markup={batteryGlyph(battery.percent, battery.state === "charging")}
                  width={30}
                  height={15}
                  color={battery.state === "discharging" && battery.percent <= 10 ? colors.batteryLow : colors.text}
                />
                <View testID="battery-percent">
                  <Text style={{ fontSize: 15, fontWeight: "semibold", color: colors.text }}>{`${battery.percent}%`}</Text>
                </View>
              </View>
            </Row>
            {battery.health !== null && (
              <Row label="Battery health" detail="How much charge it holds compared with when it was new.">
                <Value testID="battery-health">{`${battery.health}%`}</Value>
              </Row>
            )}
            {battery.cycles !== null && (
              <Row label="Cycle count">
                <Value testID="battery-cycles">{String(battery.cycles)}</Value>
              </Row>
            )}
            <Row label="Show percentage in menu bar">
              <Switch
                testID="battery-menubar"
                on={menuBar.batteryPercent ?? false}
                onChange={(batteryPercent) => settings.patch("menuBar", { batteryPercent })}
              />
            </Row>
          </Group>
        </>
      )}
      {profiles && (
        <>
          <Group testID="power-mode">
            <Row stack label="Power Mode" detail={MODE_DETAIL[profiles.active]}>
              <Choices
                testID="power-profile"
                value={profiles.active}
                options={profiles.available.map((id) => ({ value: id, label: PROFILE_LABEL[id] }))}
                onChange={(id) => isProfileId(id) && void energy.setProfile(id)}
              />
            </Row>
          </Group>
          {state.failed !== null && <Failure testID="power-failure">{`Couldn’t switch to ${PROFILE_LABEL[state.failed]}.`}</Failure>}
        </>
      )}
      <Caption above>Sleep</Caption>
      <Group testID="power-timers">
        <Row stack label="Turn display off after" detail="The screens go dark when you have been away this long.">
          <Choices
            testID="power-blank"
            options={BLANK_CHOICES}
            value={blankChoice(blank)}
            onChange={(blankAfterSeconds) => settings.patch("idle", { blankAfterSeconds })}
          />
        </Row>
        <Row stack label="Put computer to sleep after" detail="The screen locks, then the computer sleeps. Playing video or a presentation holds it off.">
          <Choices
            testID="power-sleep"
            options={SLEEP_CHOICES}
            value={sleepChoice(sleep)}
            onChange={(sleepAfterSeconds) => settings.patch("idle", { sleepAfterSeconds })}
          />
        </Row>
      </Group>
      <Caption above>{lid ? "Lid and Power Button" : "Power Button"}</Caption>
      <Group testID="power-lid">
        {lid && (
          <>
            <Row label="Closing the lid">
              <Value testID="power-lid-battery">{describeAction(lid.lid)}</Value>
            </Row>
            <Row label="Closing the lid on power">
              <Value testID="power-lid-power">{describeAction(lid.lidExternalPower)}</Value>
            </Row>
            <Row label="Closing the lid with a display attached">
              <Value testID="power-lid-docked">{describeAction(lid.lidDocked)}</Value>
            </Row>
          </>
        )}
        <Row label="Pressing the power button">
          <Value testID="power-button">Asks before shutting down</Value>
        </Row>
      </Group>
      <Caption>
        {lid ? "The lid is set by the system (logind.conf), not per user. The power button always asks first." : "The power button always asks first."}
      </Caption>
    </Page>
  );
}
