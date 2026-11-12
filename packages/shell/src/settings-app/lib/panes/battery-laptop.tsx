/**
 * Battery & Power's laptop parts (docs/0.4.0.html, Laptop features C and
 * CPU C): the power mode with Automatic (from power/modes/), where charging
 * stops, battery health (a one-time full charge, the schedule), and the
 * processor (boost, the energy preference over the mode's, the top speed on
 * battery). Each part shows only where the machine has it: the mode where
 * tuned-ppd or dashi-hardware offer modes, the rest where dashi-hardware
 * reports the knob, and battery health only on a laptop.
 */

import { useState } from "react";
import type { Laptop } from "../../../laptop/start.ts";
import { useLaptop } from "../../../laptop/store.ts";
import { chargeTarget } from "../../../power/battery-health.ts";
import { type BoostChoice, CHARGE_LIMIT_MIN, type EppChoice } from "../../../power/modes/settings.ts";
import { useModes } from "../../../power/modes/store.ts";
import { MODE_LABEL, MODE_SHORT, type ModeChoice } from "../../../power/modes/types.ts";
import { Button, Caption, Group } from "../../../shared/cards/index.ts";
import { PLUG } from "../../../shared/settings/index.ts";
import { useSettings } from "../../hooks.ts";
import { Spot } from "../../spot.tsx";
import type { SettingsStore } from "../../store.ts";
import { Choices, Slider, Switch } from "../../ui.tsx";
import { Row as Item } from "../row.tsx";
import { Setting } from "../setting.tsx";

const MODE_DETAIL = {
  "low-power": "Quieter and cooler, with less performance. Battery lasts longer.",
  balanced: "Good performance without wasting power.",
  performance: "The most performance, with more heat, fan noise, and power use.",
} as const;

/** The power mode: Automatic and the modes as pills, and what Automatic chose and why. */
export function PowerModeRow({ laptop }: { laptop: Laptop }) {
  const modes = useModes(laptop.modes);
  if (modes.available.length === 0) return null;
  const options: Array<{ value: ModeChoice; label: string }> = [
    { value: "automatic", label: "Auto" },
    ...modes.available.map((mode) => ({ value: mode, label: MODE_SHORT[mode] })),
  ];
  const effective = modes.effective;
  const detail = effective ? (modes.choice === "automatic" ? effective.why : `${effective.why}. ${MODE_DETAIL[effective.mode]}`) : undefined;
  return (
    <>
      <Setting id="battery/power-mode" stack={false} {...(detail ? { detail } : {})}>
        <Choices testID="power-mode-choice" value={modes.choice} options={options} onChange={(choice) => laptop.modes.choose(choice)} />
      </Setting>
      {modes.failed && effective && <Item label={`Couldn’t switch everything to ${MODE_LABEL[effective.mode]}.`} />}
    </>
  );
}

const pct = (value: number) => `${Math.round(value)}%`;

/** The charge limit's title: it names the limit while charging stops early ("Stop charging at 75%"). */
export function chargeLimitTitle(limit: number): string {
  return limit < 100 ? `Stop charging at ${pct(limit)}` : "Stop charging early";
}

/**
 * Where charging stops, as one control: a switch whose title names the
 * limit, and while it is on, the limit's slider under the words. The title
 * follows the slider as it moves, before the value is saved, so it never
 * says a limit the slider has left. The pane shows it where the laptop has
 * the knob; the registry's "Charge limit" row lands here too.
 */
export function ChargeLimitRow({ laptop, settings }: { laptop: Laptop; settings: SettingsStore }) {
  const machine = useLaptop(laptop.store);
  const { power } = useSettings(settings).data;
  /** The slider's value while it is being moved; null once it settled. */
  const [moving, setMoving] = useState<number | null>(null);
  const knob = machine.knobs.get("charge-limit");
  const saved = power.chargeLimit ?? 100;
  const min = Math.max(CHARGE_LIMIT_MIN, knob?.min ?? CHARGE_LIMIT_MIN);
  const early = saved < 100;
  const limit = early ? (moving ?? saved) : saved;
  const slider = early ? (
    <Slider
      testID="battery-charge-limit"
      value={limit}
      range={{ min, max: 100, step: 5 }}
      glyph={PLUG}
      format={pct}
      onChange={(value) => setMoving(Math.round(value))}
      onCommit={(value) => {
        setMoving(null);
        settings.patch("power", { chargeLimit: Math.round(value) });
      }}
    />
  ) : null;
  return (
    <Spot id="battery/charge-limit">
      <Setting id="battery/stop-charging" title={chargeLimitTitle(limit)} below={slider}>
        <Switch
          testID="battery-stop-charging"
          on={early}
          onChange={(on) => {
            setMoving(null);
            settings.patch("power", { chargeLimit: on ? Math.max(DEFAULT_EARLY_LIMIT, min) : 100 });
          }}
        />
      </Setting>
    </Spot>
  );
}

/** The limit "Stop charging early" turns on at. */
const DEFAULT_EARLY_LIMIT = 80;

/** Battery health's other parts: a full charge for a trip, and the schedule. Null without the charge limit. */
export function FullChargeGroup({ laptop, settings }: { laptop: Laptop; settings: SettingsStore }) {
  const machine = useLaptop(laptop.store);
  const { power } = useSettings(settings).data;
  const knob = machine.knobs.get("charge-limit");
  if (!machine.laptop || !knob) return null;
  const limit = power.chargeLimit ?? 100;
  const target = chargeTarget(power, new Date());
  return (
    <>
      <Caption above>Battery Health</Caption>
      <Group testID="battery-health-limit">
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
              format={(value) => (value >= top ? "No limit" : `${(value / 1_000_000).toFixed(1)} GHz`)}
              onCommit={(value) => settings.patch("power", { batteryMaxKhz: value >= top ? undefined : Math.round(value) })}
            />
          </Setting>
        )}
      </Group>
    </>
  );
}
