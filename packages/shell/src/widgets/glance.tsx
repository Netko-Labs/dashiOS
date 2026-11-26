/**
 * Glance (round five, frames 7 and 14): the lock screen at rest. Black,
 * On a screen at least 1280 pt wide it is the split lock's left half on black
 * (LK-3, lock-v3 C, D803): the day and the clock where the lock has them, and
 * Today folded into words where Today was: what is on air as one line, then
 * the counts (notifications, the song). Narrower, as below:
 * the lock's clock in real type, hours over minutes (never dots: D670),
 * dimmed to grey, and under it the one thing on air:
 * the tally's dot, its words, and a hollow ring when something waits on
 * standby. Nothing else. Its content moves a few points each minute so no
 * pixel burns in; any key or press wakes the lock screen as it was.
 */

import { InksClock, inkTokens, isSplitWidth, pill, SPACE, TRUE_BLACK, TYPE, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { onAirWords, useSecondTick } from "../tally/index.ts";
import { useWidgetEnv } from "./env.tsx";
import { SplitGlance } from "./lib/glance-split.tsx";
import { lockTime, useClockDisplay } from "./lock.tsx";

/** The burn-in nudge: where the content sits this minute, a few points from the middle, round a small square. */
export function glanceNudge(now: number): { x: number; y: number } {
  const step = Math.floor(now / 60_000) % 8;
  const ring = [
    [0, 0],
    [4, 2],
    [8, 0],
    [6, 5],
    [2, 8],
    [-3, 6],
    [-6, 2],
    [-3, -3],
  ];
  const [x, y] = ring[step] ?? [0, 0];
  return { x: x ?? 0, y: y ?? 0 };
}

/** Glance's own measures: the tally's dot and the standby ring, and the ring's line. */
const GLANCE = { dot: 8, ring: 1.3 } as const;

export function Glance({ onWake, day = "" }: { onWake: () => void; day?: string }) {
  const [width, setWidth] = useState(0);
  const measure = (bounds: { width: number }) => setWidth(bounds.width);
  const { now } = useWidgetEnv();
  if (isSplitWidth(width)) return <SplitGlance onWake={onWake} day={day} width={width} onWidth={measure} nudge={glanceNudge(now)} />;
  return <CentredGlance onWake={onWake} onWidth={measure} />;
}

function CentredGlance({ onWake, onWidth }: { onWake: () => void; onWidth: (bounds: { width: number }) => void }) {
  const { now, hour24, tally } = useWidgetEnv();
  // Black at rest whatever the mode (OLED: fewer lit pixels), so always Dark's inks, the clock in their tertiary.
  const inks = inkTokens("dark");
  const grey = inks.text.tertiary;
  const item = tally.item;
  const tick = useSecondTick(item?.countdown !== undefined);
  const nudge = glanceNudge(now);
  const display = useClockDisplay();
  const dot = { width: GLANCE.dot, height: GLANCE.dot, borderRadius: pill(GLANCE.dot) } as const;
  return (
    <View
      testID="glance"
      onPress={onWake}
      onLayout={onWidth}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: TRUE_BLACK.ground, alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ flexDirection: "column", alignItems: "center", gap: SPACE.button, marginLeft: nudge.x * 2, marginTop: nudge.y * 2 }}>
        <InksClock time={lockTime(now, hour24)} color={grey} display={display} testID="glance-clock" />
        {item ? (
          <View testID="glance-now" style={{ flexDirection: "row", alignItems: "center", gap: SPACE.gap }}>
            <View style={{ ...dot, backgroundColor: inks.tally }} />
            <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.semibold, color: item.ink ? inks.dimmed[item.ink] : grey }}>
              {(item.key.startsWith("event:") ? `Next ${onAirWords({ label: "" }, tick)}` : onAirWords(item, tick)).toUpperCase()}
            </Text>
            {tally.standby.length > 0 ? <View style={{ ...dot, borderWidth: GLANCE.ring, borderColor: grey }} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
