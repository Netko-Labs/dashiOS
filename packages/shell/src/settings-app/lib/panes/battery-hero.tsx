/**
 * Battery & Power's hero (docs/design.html, "Settings"): the battery
 * panel's numbers as the pane's picture. The charge, what it is doing (the
 * time and the watts only where the battery says them: heroes.ts
 * `batteryHero`), the gauge with the charge limit's tick, and beside it the
 * last 24 hours as a line with its time ends, its scale, and the limit
 * dashed (battery/chart.ts `chargeLine`), left out with no history yet.
 */

import { LimitBar, SPACE, TYPE, useControlColors, WEIGHT } from "@dashi/ui";
import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { chargeLine } from "../../../battery/chart.ts";
import type { Sample } from "../../../battery/history.ts";
import { formatTime, useClockPrefs } from "../../../shared/time/index.ts";
import type { Battery } from "../../../system/battery.ts";
import { batteryHero, chargeScale } from "../heroes.ts";

/** The hero's measures: the line's height and its card's corner, the line's least width, the gauge's height. */
const HERO = { line: 60, card: 20, least: 40, gauge: 12 } as const;

function ChargeLine({ samples, limit, percent }: { samples: readonly Sample[]; limit: number | null; percent: number }) {
  const colors = useControlColors();
  const clock = useClockPrefs();
  const [width, setWidth] = useState(300);
  // To the minute: within it a re-render draws the same SVG, and Metal keeps every drawing it is given.
  const now = Math.floor(Date.now() / 60000) * 60;
  const small = (text: string) => <Text style={{ fontSize: TYPE.panel.micro.size, color: colors.muted }}>{text}</Text>;
  return (
    <View
      testID="battery-hero-line"
      style={{
        flex: 1.3,
        minWidth: 0,
        flexDirection: "column",
        gap: SPACE.xs,
        paddingVertical: SPACE.m,
        paddingHorizontal: SPACE.gap,
        borderRadius: HERO.card,
        backgroundColor: colors.line,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: TYPE.panel.micro.size, color: colors.muted }}>Charge, last 24 h</Text>
        <Text style={{ fontSize: TYPE.panel.micro.size, color: colors.muted }}>{`${percent}% now`}</Text>
      </View>
      <View
        style={{ height: HERO.line }}
        onLayout={(laid: Bounds) => {
          const next = Math.max(Math.round(laid.width), HERO.least);
          if (next !== width) setWidth(next);
        }}
      >
        <Svg markup={chargeLine(samples, { width, height: HERO.line, now }, limit)} width={width} height={HERO.line} color={colors.offInk} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {small(`yesterday ${formatTime(new Date((now - 24 * 3600) * 1000), clock)}`)}
        {small(chargeScale(limit))}
        {small("now")}
      </View>
    </View>
  );
}

export function BatteryHeroView({
  battery,
  watts,
  limit,
  samples,
}: {
  battery: Battery;
  watts: number | null;
  limit: number | null;
  samples: readonly Sample[];
}) {
  const colors = useControlColors();
  const hero = batteryHero(battery, watts, limit);
  if (!hero) return null;
  return (
    <>
      <View testID="battery-hero" style={{ flex: 1, minWidth: 0, flexDirection: "column", justifyContent: "center", gap: SPACE.m, paddingLeft: SPACE.s }}>
        <View testID="battery-percent">
          <Text style={{ fontSize: TYPE.figure.size, fontWeight: WEIGHT.semibold, color: colors.offInk }}>{`${hero.percent}%`}</Text>
        </View>
        <View testID="battery-hero-status">
          <Text style={{ fontSize: TYPE.secondary.size, color: colors.muted }}>{hero.status}</Text>
        </View>
        <View style={{ flexDirection: "row", marginTop: SPACE.xs }}>
          <LimitBar percent={hero.percent} limit={hero.limit} height={HERO.gauge} />
        </View>
      </View>
      {samples.length > 0 && <ChargeLine samples={samples} limit={hero.limit} percent={hero.percent} />}
    </>
  );
}
