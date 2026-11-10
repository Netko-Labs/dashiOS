/**
 * Battery & Power's usage section, from the battery monitor (battery/): the
 * draw now and since unplugged, the last 24 hours as charts (the charge, the
 * stretches on power, the draw), what the monitor makes of it (insights), and
 * the apps using the most processor time over the last minutes.
 */

import { INFO, WARNING } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { chargingBand, drawChart, drawMax, levelChart } from "../../../battery/chart.ts";
import { averageWatts, currentDischarge, formatSpan } from "../../../battery/history.ts";
import { type BatteryMonitor, useBatteryMonitor } from "../../../battery/monitor.ts";
import type { Insight } from "../../../battery/types.ts";
import { useColors } from "../../colors.ts";
import { Caption, Group } from "../../ui.tsx";
import { Setting } from "../setting.tsx";
import { Value } from "./parts.tsx";

/** A tip: a small spark. */
const TIP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="#000"/></svg>`;
/** On power, in the charts: the battery's green. */
const CHARGING = "#30d158";
/**
 * The charts' size, said outright rather than measured: the width the pane
 * has in Settings' window (760 less the sidebar, the page's and the card's
 * padding). A wider window leaves them at this width, left-aligned with the
 * rows' labels.
 */
const CHART_WIDTH = 484;
const LEVEL_HEIGHT = 84;
/** Where it was on power: a strip under the charge. */
const BAND_HEIGHT = 4;
const DRAW_HEIGHT = 44;
const CHART_GAP = 6;

function powerLine(watts: number | null, state: string): string {
  if (watts === null) return "The battery doesn't report its draw.";
  if (state === "charging") return `Charging at ${watts.toFixed(1)} W`;
  if (state === "discharging") return `${watts.toFixed(1)} W`;
  return "On power";
}

function Insights({ items }: { items: readonly Insight[] }) {
  const colors = useColors();
  if (items.length === 0) return null;
  const glyph = { warning: WARNING, tip: TIP, info: INFO } as const;
  const tint = { warning: colors.batteryLow, tip: colors.selection, info: colors.textMuted } as const;
  return (
    <>
      <Caption above>Insights</Caption>
      <Group testID="battery-insights">
        {items.map((item) => (
          <View key={item.id} testID={`battery-insight-${item.id}`} style={{ flexDirection: "row", gap: 10, padding: 12, alignItems: "flex-start" }}>
            <View style={{ paddingTop: 1 }}>
              <Svg markup={glyph[item.tone]} size={16} color={tint[item.tone]} />
            </View>
            <View style={{ flex: 1, flexDirection: "column", gap: 2, minWidth: 0 }}>
              <Text style={{ fontSize: 13, fontWeight: "semibold", color: colors.text }}>{item.title}</Text>
              <Text style={{ fontSize: 12, color: colors.textMuted }}>{item.detail}</Text>
            </View>
          </View>
        ))}
      </Group>
    </>
  );
}

function Charts({ state }: { state: ReturnType<typeof useBatteryMonitor> }) {
  const colors = useColors();
  // To the minute: within it a re-render draws the same SVG, and Metal keeps every drawing it is given.
  const now = Math.floor(Date.now() / 60000) * 60;
  const max = drawMax(state.samples.filter((sample) => sample.t >= now - 24 * 3600));
  const box = (height: number) => ({ width: CHART_WIDTH, height, now });
  const legend = (color: string, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: color }} />
      <Text style={{ fontSize: 11, color: colors.textMuted }}>{label}</Text>
    </View>
  );
  const axis = (label: string) => <Text style={{ fontSize: 10, color: colors.textMuted }}>{label}</Text>;
  return (
    <View testID="battery-charts" style={{ flexDirection: "column", gap: CHART_GAP, padding: 12 }}>
      <View style={{ flexDirection: "row", gap: 14, marginBottom: 2 }}>
        {legend(colors.text, "Charge")}
        {legend(CHARGING, "On power")}
        {legend(colors.selection, `Draw on battery (0–${max} W)`)}
      </View>
      <Svg markup={levelChart(state.samples, box(LEVEL_HEIGHT))} width={CHART_WIDTH} height={LEVEL_HEIGHT} color={colors.text} />
      <Svg markup={chargingBand(state.samples, box(BAND_HEIGHT), BAND_HEIGHT)} width={CHART_WIDTH} height={BAND_HEIGHT} color={CHARGING} />
      <Svg markup={drawChart(state.samples, box(DRAW_HEIGHT), max)} width={CHART_WIDTH} height={DRAW_HEIGHT} color={colors.selection} />
      <View style={{ width: CHART_WIDTH, flexDirection: "row", justifyContent: "space-between" }}>
        {axis("24 h ago")}
        {axis("12 h ago")}
        {axis("Now")}
      </View>
    </View>
  );
}

export function BatteryUsage({ monitor }: { monitor: BatteryMonitor }) {
  const colors = useColors();
  const state = useBatteryMonitor(monitor);
  if (!state.available || !state.battery) return null;
  const run = currentDischarge(state.samples);
  const since = run ? averageWatts(state.samples.filter((sample) => sample.t >= run.since)) : null;
  const heaviest = state.apps.slice(0, 5);
  const top = Math.max(0.01, ...heaviest.map((app) => app.cores));
  return (
    <>
      <Caption above>Battery Usage</Caption>
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
          <Caption above>Energy Use by App</Caption>
          <Group testID="battery-apps">
            {heaviest.map((app) => (
              <View
                key={app.key}
                testID={`battery-app-${app.name}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 36, paddingHorizontal: 12 }}
              >
                <View style={{ width: 160, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
                    {app.name}
                  </Text>
                </View>
                <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.button }}>
                  <View style={{ width: `${Math.max(2, (app.cores / top) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: colors.selection }} />
                </View>
                <View style={{ width: 70, alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>{`${Math.round(app.cores * 100)}% CPU`}</Text>
                </View>
              </View>
            ))}
          </Group>
          <Caption>The last ten minutes. Processor time is most of what an app costs the battery; the screen and radios are the rest.</Caption>
        </>
      )}
    </>
  );
}
