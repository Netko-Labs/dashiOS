/** Clock and World Clocks (plain ink), Battery (matcha) and System (plain ink). */

import { View } from "@mirinjs/metal";
import { hereZone, zoneCity } from "../../../shared/calendar/index.ts";
import { DotRow } from "../../../shared/inks/index.ts";
import { useWidgetEnv } from "../../env.tsx";
import { useCard } from "../../look.tsx";
import { Glyph, Grow, Head, Lab, Meta, Num, Rule, VRule, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { clockText, useSource } from "../data.ts";

const dayWords = (now: number): string => new Date(now).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** The time in a zone, as the widget writes it. */
function zoneClock(now: number, zone: string, hour24: boolean): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hour12: !hour24 }).formatToParts(new Date(now));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour24 ? hour : String(Number(hour) || 12)}:${minute}`;
}

/** Hours `zone` is ahead of here: "−5 h", "+9 h", "Home". */
function offsetWords(now: number, zone: string): string {
  const at = (z: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: z, hour: "numeric", minute: "numeric", day: "numeric", hourCycle: "h23" }).formatToParts(
      new Date(now),
    );
    const n = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return n("day") * 1440 + n("hour") * 60 + n("minute");
  };
  const hours = Math.round((at(zone) - at(hereZone())) / 60);
  if (zone === hereZone() || hours === 0) return "Home";
  return `${hours > 0 ? "+" : "−"}${Math.abs(hours)} h`;
}

export const WORLD_ZONES = ["America/New_York", "Asia/Tokyo"];

export function ClockWidget({ size }: { size: WidgetSize }) {
  const { now, hour24 } = useWidgetEnv();
  const time = clockText(now, hour24);
  const city = zoneCity(hereZone());
  if (size === "mini") {
    const [h, m] = time.split(":");
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <Num value={h ?? ""} size={28} plain />
        <Num value={m ?? ""} size={28} plain />
      </View>
    );
  }
  return (
    <>
      <Head left={<Lab>{city}</Lab>} right={<Meta>{dayWords(now)}</Meta>} />
      <Grow />
      <Num value={time} size={size === "compact" ? 40 : 58} plain />
      {size === "small" ? (
        <>
          <Grow />
          {WORLD_ZONES.slice(0, 2).map((zone) => (
            <View key={zone} style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 3 }}>
              <Words>{zoneCity(zone)}</Words>
              <Words ink>{zoneClock(now, zone, hour24)}</Words>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

export function WorldWidget({ size }: { size: WidgetSize }) {
  const { now, hour24 } = useWidgetEnv();
  const zones = [hereZone(), ...WORLD_ZONES.filter((zone) => zone !== hereZone())].slice(0, size === "wide" ? 3 : 2);
  const c = useCard();
  return (
    <>
      <Head left={<Lab>World clocks</Lab>} right={<Meta>{dayWords(now)}</Meta>} />
      <Grow />
      <View style={{ flexDirection: "row", alignItems: "stretch" }}>
        {zones.map((zone, i) => {
          const hour = new Date(new Date(now).toLocaleString("en-US", { timeZone: zone })).getHours();
          return (
            <View key={zone} style={{ flexDirection: "row", flex: i ? 1 : 1.3 }}>
              {i ? <VRule margin={12} /> : null}
              <View style={{ flexDirection: "column", gap: 6, flex: 1 }}>
                <Num value={zoneClock(now, zone, hour24)} size={i ? 28 : 38} plain />
                <Lab>{zoneCity(zone)}</Lab>
                <Meta>{offsetWords(now, zone)}</Meta>
                <DotRow count={i ? 9 : 12} value={hour / 24} radius={0.3} lit={c.ink} unlit={c.off} />
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}

const batteryWords = (state: string, percent: number, minutes: number | undefined): string => {
  if (state === "charging") return minutes ? `Full in ${Math.round(minutes)} min` : "Charging";
  if (state === "plugged") return "On the charger";
  if (minutes) return minutes >= 60 ? `About ${Math.round(minutes / 60)} h left` : `About ${Math.round(minutes)} min left`;
  return percent < 20 ? "Low" : "On battery";
};

export function BatteryWidget({ size }: { size: WidgetSize }) {
  const { hub } = useWidgetEnv();
  const c = useCard();
  const battery = useSource(hub?.system, { battery: null }).battery;
  if (!battery)
    return (
      <>
        <Head left={<Lab>This computer</Lab>} right={<Glyph name="bolt" size={13} tone="value" />} />
        <Grow />
        <Words>No battery: it runs on the wall.</Words>
      </>
    );
  const words = batteryWords(battery.state, battery.percent, battery.minutesLeft);
  return (
    <>
      <Head left={<Lab>{battery.state === "charging" ? "Charging" : "This laptop"}</Lab>} right={<Glyph name="bolt" size={13} tone="value" />} />
      <Grow />
      <Num value={String(battery.percent)} unit="%" size={size === "compact" ? 40 : 76} weight={battery.percent / 100} />
      {size === "small" ? (
        <>
          <Grow />
          <Words>{words}</Words>
          <View style={{ height: 7 }} />
          <DotRow count={20} value={battery.percent / 100} pitch={7.2} radius={0.3} lit={c.value} unlit={c.off} />
        </>
      ) : (
        <Meta>{words}</Meta>
      )}
    </>
  );
}

export function SystemWidget({ size }: { size: WidgetSize }) {
  const { hub } = useWidgetEnv();
  const c = useCard();
  const load = useSource(hub?.load, null);
  if (!load)
    return (
      <>
        <Head left={<Lab>Processor</Lab>} />
        <Grow />
        <Words>Reading…</Words>
      </>
    );
  const rows: [string, string][] = [
    ["Memory", `${load.memoryUsed} / ${load.memoryTotal} GB`],
    ...(load.graphics === null ? [] : [["Graphics", `${load.graphics} %`] as [string, string]]),
  ];
  return (
    <>
      <Head left={<Lab>{size === "wide" ? "System" : "Processor"}</Lab>} right={<Meta>{`${load.cores} cores`}</Meta>} />
      <Grow />
      <Num value={String(load.processor)} unit="%" size={size === "wide" ? 46 : 76} plain />
      {size === "wide" ? <DotRow count={30} value={load.processor / 100} radius={0.3} lit={c.ink} unlit={c.off} /> : null}
      <Grow />
      {rows.map(([name, value], i) => (
        <View key={name} style={{ flexDirection: "column" }}>
          {i ? <Rule /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: 3, paddingBottom: 3 }}>
            <Words>{name}</Words>
            <Words ink>{value}</Words>
          </View>
        </View>
      ))}
    </>
  );
}
