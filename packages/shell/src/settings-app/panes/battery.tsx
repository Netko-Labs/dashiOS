/**
 * Battery & Power (docs/design.html, "Settings"): its hero is the battery
 * panel's numbers (battery-hero.tsx: the charge, the time and watts the
 * battery reports, the gauge with the limit's tick, the last 24 hours).
 * Then the power mode with all its modes in one row of pills and what
 * Automatic chose and why (power/modes/; power-profiles-daemon's profiles on
 * a machine without them), where charging stops (one row: its switch names
 * the limit, its slider under it); then what Dashi lowers on battery
 * (on-battery.tsx), when the display turns off and the computer sleeps (the
 * four usual times as pills, "More" for the rest). Under those: the
 * battery's health and cycles and whether the menu bar shows its
 * percentage, a full charge for a trip, the processor (battery-laptop.tsx),
 * the usage (battery-usage.tsx), and what the lid and power button do.
 * Parts that do not apply are left out: a desktop has no battery, and a
 * machine without the daemon has no power modes. The lid is logind's
 * configuration (/etc/systemd/logind.conf), shown as it is.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { BatteryMonitor, BatteryMonitorState } from "../../battery/index.ts";
import type { Laptop } from "../../laptop/start.ts";
import { useLaptop } from "../../laptop/store.ts";
import { describeAction } from "../../power/policy.ts";
import { useEnergy } from "../../system/energy.ts";
import { isProfileId, PROFILE_LABEL } from "../../system/profiles.ts";
import { BLANK_CHOICES, BLANK_COMMON, blankChoice, SLEEP_CHOICES, SLEEP_COMMON, sleepChoice, timePills } from "../controls.ts";
import { useSettings } from "../hooks.ts";
import type { PaneServices } from "../services.ts";
import { Spot } from "../spot.tsx";
import { DEFAULT_BLANK_AFTER, type SettingsStore } from "../store.ts";
import { Caption, Choices, Group, Hero, Page, Setting } from "../ui.tsx";
import { BatteryHeroView } from "./battery-hero.tsx";
import { ChargeLimitRow, FullChargeGroup, PowerModeRow, ProcessorGroup } from "./battery-laptop.tsx";
import { BatteryUsage } from "./battery-usage.tsx";
import { OnBatteryRow, type ShowPane, useOnBattery } from "./on-battery.tsx";
import { Failure, Value } from "./parts.tsx";

const MODE_DETAIL = {
  "power-saver": "Quieter and cooler, with less performance. Battery lasts longer.",
  balanced: "Good performance without wasting power.",
  performance: "The most performance, with more heat, fan noise, and power use.",
} as const;

const NO_MONITOR = { subscribe: () => () => {}, getSnapshot: (): BatteryMonitorState | null => null };

/** The monitor's reading, null without a monitor. */
function useMonitorState(monitor: BatteryMonitor | null): BatteryMonitorState | null {
  return useSyncExternalStore(monitor?.subscribe ?? NO_MONITOR.subscribe, monitor?.getSnapshot ?? NO_MONITOR.getSnapshot);
}

/** The charge limit the gauge ticks: the saved one where the laptop can stop charging, else none. */
function useChargeLimit(laptop: Laptop | null, settings: SettingsStore): number | null {
  const machine = useLaptop(laptop?.store ?? NO_LAPTOP);
  const { power } = useSettings(settings).data;
  return machine.laptop && machine.knobs.get("charge-limit") ? (power.chargeLimit ?? 100) : null;
}

const NO_LAPTOP = {
  subscribe: () => () => {},
  getSnapshot: (() => {
    const empty = { laptop: false, helper: false, model: null, knobs: new Map(), keyboardLevels: null };
    return () => empty;
  })(),
};

export function BatteryPane({ services, settings, show }: { services: PaneServices; settings: SettingsStore; show: ShowPane }) {
  const { energy } = services;
  const state = useEnergy(energy);
  const monitor = useMonitorState(services.battery);
  const { idle } = useSettings(settings).data;
  const limit = useChargeLimit(services.laptop, settings);
  const lowers = useOnBattery(services.laptop, services.refresh);
  useEffect(() => {
    energy.open();
    return () => energy.close();
  }, [energy]);
  const { battery, profiles, lid } = state;
  const blank = idle.blankAfterSeconds ?? DEFAULT_BLANK_AFTER;
  const sleep = idle.sleepAfterSeconds ?? 0;
  // The monitor's reading carries the watts and the history; the energy store's, the health.
  const reading = monitor?.battery ?? battery;
  return (
    <Page title="Battery & Power">
      {reading && (
        // The hero is the "Battery" row: it says the charge and what the battery does, so search lands here.
        <Spot id="battery/battery" cards>
          <Hero testID="battery-hero-card">
            <BatteryHeroView battery={reading} watts={monitor?.watts ?? null} limit={limit} samples={monitor?.samples ?? []} />
          </Hero>
        </Spot>
      )}
      <Group testID="power-mode">
        {services.laptop && <PowerModeRow laptop={services.laptop} />}
        {!services.laptop && profiles && (
          <Setting id="battery/power-mode" stack={false} detail={MODE_DETAIL[profiles.active]}>
            <Choices
              testID="power-profile"
              value={profiles.active}
              options={profiles.available.map((id) => ({ value: id, label: PROFILE_LABEL[id] }))}
              onChange={(id) => isProfileId(id) && void energy.setProfile(id)}
            />
          </Setting>
        )}
        {services.laptop && limit !== null && <ChargeLimitRow laptop={services.laptop} settings={settings} />}
      </Group>
      {!services.laptop && state.failed !== null && <Failure testID="power-failure">{`Couldn’t switch to ${PROFILE_LABEL[state.failed]}.`}</Failure>}
      <Group testID="power-timers">
        {battery && lowers && <OnBatteryRow laptop={services.laptop} refresh={services.refresh} show={show} />}
        <Setting id="battery/turn-display-off" title="Turn the screen off after" stack={false} detail={null}>
          <Choices
            testID="power-blank"
            options={timePills(BLANK_CHOICES)}
            common={BLANK_COMMON}
            value={blankChoice(blank)}
            onChange={(blankAfterSeconds) => settings.patch("idle", { blankAfterSeconds })}
          />
        </Setting>
        <Setting id="battery/sleep-after" title="Sleep after" stack={false} detail={null}>
          <Choices
            testID="power-sleep"
            options={timePills(SLEEP_CHOICES)}
            common={SLEEP_COMMON}
            value={sleepChoice(sleep)}
            onChange={(sleepAfterSeconds) => settings.patch("idle", { sleepAfterSeconds })}
          />
        </Setting>
      </Group>
      {battery && (
        <>
          <Caption above>Battery</Caption>
          <Group testID="battery-status">
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
        </>
      )}
      {services.laptop && (
        <>
          <FullChargeGroup laptop={services.laptop} settings={settings} />
          <ProcessorGroup laptop={services.laptop} settings={settings} />
        </>
      )}
      {battery && services.battery && <BatteryUsage monitor={services.battery} />}
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
