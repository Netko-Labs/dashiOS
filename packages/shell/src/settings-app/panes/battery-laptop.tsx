/**
 * Battery & Power's laptop parts (docs/0.4.0.html, Laptop features C and
 * CPU C): the power mode with Automatic (from power/modes/), battery health
 * (the charge limit, a one-time full charge, the schedule), and the
 * processor (boost, the energy preference over the mode's, the top speed on
 * battery). Each part shows only where the machine has it: the mode where
 * tuned-ppd or dashi-hardware offer modes, the rest where dashi-hardware
 * reports the knob, and battery health only on a laptop.
 */

import { Switch, useColors } from "@dashi/ui";
import { Text } from "@mirinjs/metal";
import type { Laptop } from "../../laptop/start.ts";
import { useLaptop } from "../../laptop/store.ts";
import { chargeTarget } from "../../power/battery-health.ts";
import { type BoostChoice, CHARGE_LIMIT_MIN, type EppChoice } from "../../power/modes/settings.ts";
import { useModes } from "../../power/modes/store.ts";
import { MODE_LABEL, MODE_SHORT, type ModeChoice } from "../../power/modes/types.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Item, Setting, Slider } from "../ui.tsx";

const MODE_DETAIL = {
  "low-power": "Quieter and cooler, with less performance. Battery lasts longer.",
  balanced: "Good performance without wasting power.",
  performance: "The most performance, with more heat, fan noise, and power use.",
} as const;

/** The mode row: Automatic and the three, and in one line what is in effect and why. */
export function PowerModeGroup({ laptop }: { laptop: Laptop }) {
  const modes = useModes(laptop.modes);
  if (modes.available.length === 0) return null;
  const options: Array<{ value: ModeChoice; label: string }> = [
    { value: "automatic", label: "Automatic" },
    ...modes.available.map((mode) => ({ value: mode, label: MODE_SHORT[mode] })),
  ];
  const effective = modes.effective;
  const detail = effective
    ? `${effective.why}. ${modes.choice === "automatic" ? "Follows the power source and the battery level." : MODE_DETAIL[effective.mode]}`
    : undefined;
  return (
    <Group testID="power-mode">
      <Setting id="battery/power-mode" {...(detail ? { detail } : {})}>
        <Choices testID="power-mode-choice" value={modes.choice} options={options} onChange={(choice) => laptop.modes.choose(choice)} />
      </Setting>
      {modes.failed && effective && <Item label={`Couldn’t switch everything to ${MODE_LABEL[effective.mode]}.`} />}
    </Group>
  );
}

const pct = (value: number) => `${Math.round(value)}%`;

/** Battery health: where charging stops, a full charge for a trip, and the schedule. */
export function BatteryHealthGroup({ laptop, settings }: { laptop: Laptop; settings: SettingsStore }) {
  const colors = useColors();
  const machine = useLaptop(laptop.store);
  const { power } = useSettings(settings).data;
  const knob = machine.knobs.get("charge-limit");
  if (!machine.laptop || !knob) return null;
  const limit = power.chargeLimit ?? 100;
  const target = chargeTarget(power, new Date());
  const min = Math.max(CHARGE_LIMIT_MIN, knob.min ?? CHARGE_LIMIT_MIN);
  return (
    <>
      <Caption above>Battery Health</Caption>
      <Group testID="battery-health-limit">
        <Setting id="battery/charge-limit">
          <Slider
            testID="battery-charge-limit"
            value={limit}
            range={{ min, max: 100, step: 5 }}
            onCommit={(value) => settings.patch("power", { chargeLimit: Math.round(value) })}
          />
          <Text style={{ fontSize: 12, color: colors.textMuted }}>{pct(limit)}</Text>
        </Setting>
        <Setting id="battery/full-charge-once" detail={power.fullChargeOnce ? (target.why ?? "") : undefined}>
          <Button
            testID="battery-full-once"
            label={power.fullChargeOnce ? "Charging" : "Charge Now"}
            disabled={power.fullChargeOnce === true || limit >= 100}
            onPress={() => settings.patch("power", { fullChargeOnce: true })}
          />
        </Setting>
        <Setting
          id="battery/full-by"
          detail={power.fullBy ? `Full by ${power.fullBy} ${power.fullByDays === "daily" ? "every day" : "on weekdays"}.` : undefined}
        >
          <Switch testID="battery-full-by" on={power.fullBy !== undefined} onChange={(on) => settings.patch("power", { fullBy: on ? "08:00" : undefined })} />
        </Setting>
        {power.fullBy !== undefined && (
          <Setting id="battery/full-by-when">
            <Choices
              testID="battery-full-by-time"
              value={power.fullBy}
              options={["06:00", "07:00", "08:00", "09:00"].map((time) => ({ value: time, label: time }))}
              onChange={(fullBy) => settings.patch("power", { fullBy })}
            />
            <Choices
              testID="battery-full-by-days"
              value={power.fullByDays ?? "weekdays"}
              options={[
                { value: "weekdays", label: "Weekdays" },
                { value: "daily", label: "Every day" },
              ]}
              onChange={(fullByDays) => settings.patch("power", { fullByDays })}
            />
          </Setting>
        )}
      </Group>
    </>
  );
}

const BOOST_OPTIONS: Array<{ value: BoostChoice; label: string }> = [
  { value: "always", label: "Always" },
  { value: "plugged", label: "Plugged in" },
  { value: "off", label: "Off" },
];
const EPP_OPTIONS: Array<{ value: EppChoice; label: string }> = [
  { value: "recipe", label: "By mode" },
  { value: "power", label: "Battery" },
  { value: "balance_power", label: "Balance" },
  { value: "performance", label: "Speed" },
];

/** The processor: boost, the energy preference over the mode's, and the top speed on battery. */
export function ProcessorGroup({ laptop, settings }: { laptop: Laptop; settings: SettingsStore }) {
  const colors = useColors();
  const machine = useLaptop(laptop.store);
  const { power } = useSettings(settings).data;
  const boost = machine.knobs.get("boost");
  const epp = machine.knobs.get("epp");
  const freq = machine.knobs.get("cpu-max-freq");
  if (!boost && !epp && !freq) return null;
  const eppOptions = EPP_OPTIONS.filter((option) => option.value === "recipe" || (epp?.choices ?? []).includes(option.value));
  // In kHz, as cpufreq counts; the slider moves in 100 MHz steps.
  const top = freq?.max ?? 5_000_000;
  const low = Math.max(freq?.min ?? 1_000_000, 1_000_000);
  const cap = power.batteryMaxKhz && power.batteryMaxKhz > 0 ? power.batteryMaxKhz : top;
  return (
    <>
      <Caption above>Processor</Caption>
      <Group testID="power-processor">
        {boost && (
          <Setting id="battery/boost">
            <Choices testID="power-boost" value={power.boost ?? "always"} options={BOOST_OPTIONS} onChange={(boost) => settings.patch("power", { boost })} />
          </Setting>
        )}
        {epp && eppOptions.length > 1 && (
          <Setting id="battery/prefer">
            <Choices
              testID="power-epp"
              value={power.epp ?? "recipe"}
              options={eppOptions}
              onChange={(value) => settings.patch("power", { epp: value === "recipe" ? undefined : value })}
            />
          </Setting>
        )}
        {freq && (
          <Setting id="battery/top-speed">
            <Slider
              testID="power-battery-cap"
              value={cap}
              range={{ min: low, max: top, step: 100_000 }}
              onCommit={(value) => settings.patch("power", { batteryMaxKhz: value >= top ? undefined : Math.round(value) })}
            />
            <Text style={{ fontSize: 12, color: colors.textMuted }}>{cap >= top ? "No limit" : `${(cap / 1_000_000).toFixed(1)} GHz`}</Text>
          </Setting>
        )}
      </Group>
    </>
  );
}
