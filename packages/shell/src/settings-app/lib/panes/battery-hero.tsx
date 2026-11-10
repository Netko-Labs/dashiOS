/**
 * Battery & Power's hero (docs/design.html, "Settings"): the battery
 * panel's numbers as the pane's picture. The charge, what it is doing (the
 * time and the watts only where the battery says them: heroes.ts
 * `batteryHero`), the gauge with the charge limit's tick, and beside it the
 * last 24 hours as a line with its time ends, its scale, and the limit
 * dashed (battery/chart.ts `chargeLine`), left out with no history yet.
 */

import { type Bounds, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { chargeLine } from "../../../battery/chart.ts";
import type { Sample } from "../../../battery/history.ts";
import { useControlColors } from "../../../shared/controls/palette.ts";
import { LimitBar } from "../../../shared/controls/parts.tsx";
import { formatTime, useClockPrefs } from "../../../shared/time/clock.ts";
import type { Battery } from "../../../system/battery.ts";
import { batteryHero, chargeScale } from "../heroes.ts";

const LINE_HEIGHT = 60;

function ChargeLine({ samples, limit, percent }: { samples: readonly Sample[]; limit: number | null; percent: number }) {
  const colors = useControlColors();
  const clock = useClockPrefs();
  const [width, setWidth] = useState(300);
  // To the minute: within it a re-render draws the same SVG, and Metal keeps every drawing it is given.
  const now = Math.floor(Date.now() / 60000) * 60;
  const small = (text: string) => <Text style={{ fontSize: 10, color: colors.muted }}>{text}</Text>;
  return (
    <View
      testID="battery-hero-line"
      style={{
        flex: 1.3,
        minWidth: 0,
        flexDirection: "column",
        gap: 4,
        paddingTop: 8,
        paddingBottom: 8,
        paddingLeft: 10,
        paddingRight: 10,
        borderRadius: 20,
        backgroundColor: colors.line,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 10.5, color: colors.muted }}>Charge, last 24 h</Text>
        <Text style={{ fontSize: 10.5, color: colors.muted }}>{`${percent}% now`}</Text>
      </View>
      <View
        style={{ height: LINE_HEIGHT }}
        onLayout={(laid: Bounds) => {
          const next = Math.max(Math.round(laid.width), 40);
          if (next !== width) setWidth(next);
        }}
      >
        <Svg markup={chargeLine(samples, { width, height: LINE_HEIGHT, now }, limit)} width={width} height={LINE_HEIGHT} color={colors.offInk} />
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
      <View testID="battery-hero" style={{ flex: 1, minWidth: 0, flexDirection: "column", justifyContent: "center", gap: 8, paddingLeft: 6 }}>
        <View testID="battery-percent">
          <Text style={{ fontSize: 30, fontWeight: "semibold", color: colors.offInk }}>{`${hero.percent}%`}</Text>
        </View>
        <View testID="battery-hero-status">
          <Text style={{ fontSize: 12, color: colors.muted }}>{hero.status}</Text>
        </View>
        <View style={{ flexDirection: "row", marginTop: 4 }}>
          <LimitBar percent={hero.percent} limit={hero.limit} height={12} />
        </View>
      </View>
      {samples.length > 0 && <ChargeLine samples={samples} limit={hero.limit} percent={hero.percent} />}
    </>
  );
}
