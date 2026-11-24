/**
 * Battery & Power's usage section, from the battery monitor (battery/): the
 * draw now and since unplugged, the last 24 hours as charts (the charge, the
 * stretches on power, the draw), what the monitor makes of it (insights), and
 * the apps using the most processor time over the last minutes.
 */

import { INFO, pill, RADIUS, SPACE, TINTS, TYPE, WARNING } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { chargingBand, drawChart, drawMax, levelChart } from "../../../battery/chart.ts";
import { averageWatts, currentDischarge, formatSpan } from "../../../battery/history.ts";
import { type BatteryMonitor, useBatteryMonitor } from "../../../battery/monitor.ts";
import type { Insight } from "../../../battery/types.ts";
import { Caption, Group } from "../../../shared/cards/index.ts";
import { useColors } from "../../colors.ts";
import { PAGE } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { ListRow, Value } from "./parts.tsx";

/** A tip: a small spark. */
const TIP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="#000"/></svg>`;

/**
 * The charts' colours (CO-13: readings are ink or a Tint, never the on
 * colour or the accent, never another platform's): the charge in ink, the
 * stretches on power in matcha (Battery & Power's tint), the draw in mizu,
 * the chart order's first.
 */
const SERIES = { power: TINTS.matcha, draw: TINTS.mizu } as const;

/**
 * The charts' measures: the width before the card is laid out (then the
 * card's own, less its insets: SE-A31), the charge's, the band's and the
 * draw's heights, a legend swatch; an app's bar; an insight's glyph.
 */
const CHART = { width: 484, level: 84, band: 4, draw: 44, swatch: 8, bar: 6, barWidth: 140, glyph: 16 } as const;

function powerLine(watts: number | null, state: string): string {
  if (watts === null) return "The battery doesn't report its draw.";
  if (state === "charging") return `Charging at ${watts.toFixed(1)} W`;
  if (state === "discharging") return `${watts.toFixed(1)} W`;
  return "On power";
}

/** The insights, as list rows: a glyph in a knob's slot (its job's colour: a warning ume, a tip or a fact muted), the finding and what it means. */
function Insights({ items }: { items: readonly Insight[] }) {
  const colors = useColors();
  if (items.length === 0) return null;
  const glyph = { warning: WARNING, tip: TIP, info: INFO } as const;
  const tint = { warning: colors.batteryLow, tip: colors.textMuted, info: colors.textMuted } as const;
  return (
    <>
      <Caption above>Insights</Caption>
      <Group testID="battery-insights">
        {items.map((item) => (
          <ListRow
            key={item.id}
            testID={`battery-insight-${item.id}`}
            name={item.title}
            detail={item.detail}
            wrap
            leading={
              <View style={{ width: PAGE.knob, alignItems: "center" }}>
                <Svg markup={glyph[item.tone]} size={CHART.glyph} color={tint[item.tone]} />
              </View>
            }
          />
        ))}
      </Group>
    </>
  );
}

function Charts({ state }: { state: ReturnType<typeof useBatteryMonitor> }) {
  const colors = useColors();
  const [width, setWidth] = useState<number>(CHART.width);
  // To the minute: within it a re-render draws the same SVG, and Metal keeps every drawing it is given.
  const now = Math.floor(Date.now() / 60000) * 60;
  const max = drawMax(state.samples.filter((sample) => sample.t >= now - 24 * 3600));
  const box = (height: number) => ({ width, height, now });
  const legend = (color: string, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.s }}>
      <View style={{ width: CHART.swatch, height: CHART.swatch, borderRadius: RADIUS.thumb, backgroundColor: color }} />
      <Text style={{ fontSize: TYPE.caption.size, color: colors.textMuted }}>{label}</Text>
    </View>
  );
  const axis = (label: string) => <Text style={{ fontSize: TYPE.panel.micro.size, color: colors.textMuted }}>{label}</Text>;
  return (
    <View
      testID="battery-charts"
      // The card's width, less the rows' insets: the charts fill it in any window.
      onLayout={(laid) => setWidth(Math.max(0, Math.round(laid.width) - 2 * PAGE.inset))}
      style={{ flexDirection: "column", gap: SPACE.s, paddingHorizontal: PAGE.inset, paddingVertical: SPACE.inset }}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: SPACE.button, rowGap: SPACE.xs, marginBottom: SPACE.xxs }}>
        {legend(colors.text, "Charge")}
        {legend(SERIES.power, "On power")}
        {legend(SERIES.draw, `Draw on battery (0–${max} W)`)}
      </View>
      <Svg markup={levelChart(state.samples, box(CHART.level))} width={width} height={CHART.level} color={colors.text} />
      <Svg markup={chargingBand(state.samples, box(CHART.band), CHART.band)} width={width} height={CHART.band} color={SERIES.power} />
      <Svg markup={drawChart(state.samples, box(CHART.draw), max)} width={width} height={CHART.draw} color={SERIES.draw} />
      <View style={{ width, flexDirection: "row", justifyContent: "space-between" }}>
        {axis("24 h ago")}
        {axis("12 h ago")}
        {axis("Now")}
      </View>
    </View>
  );
}

/** An app's share of the processor, as a bar in ink on the line's colour (a reading, as Sound's meters: CO-13). */
function ShareBar({ share }: { share: number }) {
  const colors = useColors();
  return (
    <View style={{ width: CHART.barWidth, height: CHART.bar, borderRadius: pill(CHART.bar), backgroundColor: colors.separator }}>
      <View style={{ width: `${Math.max(2, share * 100)}%`, height: CHART.bar, borderRadius: pill(CHART.bar), backgroundColor: colors.text }} />
    </View>
  );
}

export function BatteryUsage({ monitor }: { monitor: BatteryMonitor }) {
  const state = useBatteryMonitor(monitor);
  if (!state.available || !state.battery) return null;
  const run = currentDischarge(state.samples);
  const since = run ? averageWatts(state.samples.filter((sample) => sample.t >= run.since)) : null;
  const heaviest = state.apps.slice(0, 5);
  const top = Math.max(0.01, ...heaviest.map((app) => app.cores));
  return (
    <>
      <Caption above>Battery usage</Caption>
      <Group testID="battery-usage">
        <Setting
          id="battery/power-draw"
          detail={run && since !== null ? `${since.toFixed(1)} W on average since unplugged ${formatSpan(Date.now() / 1000 - run.since)} ago` : null}
        >
          <Value testID="battery-draw">{powerLine(state.watts, state.battery.state)}</Value>
        </Setting>
        {run && (
          <Setting id="battery/since-unplugged" detail={run.perHour === null ? null : `${run.perHour}% an hour while awake`}>
            <Value testID="battery-since">{`${run.used}% used`}</Value>
          </Setting>
        )}
        <Charts state={state} />
      </Group>
      <Insights items={state.insights} />
      {heaviest.length > 0 && (
        <>
          <Caption above>Energy use by app</Caption>
          <Group testID="battery-apps">
            {heaviest.map((app) => (
              <ListRow key={app.key} testID={`battery-app-${app.name}`} name={app.name} detail={`${Math.round(app.cores * 100)}% CPU`}>
                <ShareBar share={app.cores / top} />
              </ListRow>
            ))}
          </Group>
          <Caption>The last ten minutes. Processor time is most of what an app costs the battery; the screen and radios are the rest.</Caption>
        </>
      )}
    </>
  );
}
