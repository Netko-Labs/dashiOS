/** Weather (mizu): the temperature large; rain's hour; stale and down say so, the value then in plain ink. */

import { View } from "@mirinjs/metal";
import { useWidgetEnv } from "../../env.tsx";
import { Glyph, Grow, Head, Lab, Meta, Num, Title, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { ago, clockText, useSource } from "../data.ts";
import { weatherLook } from "../sources/weather.ts";

export function WeatherWidget({ size }: { size: WidgetSize }) {
  const { hub, now, hour24 } = useWidgetEnv();
  const state = useSource(hub?.weather, { status: "loading" } as const);
  if (state.status === "loading" || state.status === "down")
    return (
      <>
        <Head left={<Lab>Weather</Lab>} right={<Glyph name="cloud" size={14} tone="tertiary" />} />
        <Grow />
        <Words>{state.status === "loading" ? "Looking…" : "Weather isn't answering"}</Words>
      </>
    );
  const { now: w } = state;
  const stale = state.status === "stale";
  const look = weatherLook(w.code);
  const rain = w.rainFrom === null ? "No rain soon" : `Rain from ${clockText(w.rainFrom, hour24)}`;
  const range = `H ${w.high}° · L ${w.low}°`;
  if (size === "compact")
    return (
      <>
        <Head left={<Lab>{w.place}</Lab>} right={<Glyph name={look.glyph} size={14} tone="value" />} />
        <Grow />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
          <Num value={String(w.temperature)} unit="°" size={40} plain={stale} />
          <Meta>{stale ? `Updated ${ago(w.at, now)}` : `H${w.high} · L${w.low}`}</Meta>
        </View>
      </>
    );
  return (
    <>
      <Head
        left={<Lab>{size === "wide" ? `${w.place} · ${look.words.toLowerCase()}` : w.place}</Lab>}
        right={size === "wide" ? <Meta>{range}</Meta> : <Glyph name={stale ? "cloud" : look.glyph} size={15} tone={stale ? "tertiary" : "value"} />}
      />
      <Grow />
      <Num value={String(w.temperature)} unit="°" size={76} plain={stale} />
      <Grow />
      {stale ? (
        <>
          <Title>{`Updated ${ago(w.at, now)}`}</Title>
          <Words>Open-Meteo isn't answering</Words>
        </>
      ) : (
        <>
          <Title>{rain}</Title>
          {size === "wide" ? <Words>{look.words}</Words> : <Words>{range}</Words>}
        </>
      )}
    </>
  );
}
