/**
 * Glance (round five, frames 7 and 14): the lock screen at rest. Black,
 * the clock in real type (never dots), and under it the one thing on air:
 * the tally's dot, its words, and a hollow ring when something waits on
 * standby. Nothing else. Its content moves a few points each minute so no
 * pixel burns in; any key or press wakes the lock screen as it was.
 */

import { Text, View } from "@mirinjs/metal";
import { onAirWords, useSecondTick } from "../tally/index.ts";
import { useWidgetEnv } from "./env.tsx";
import { clockText } from "./lib/data.ts";

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

export function Glance({ onWake }: { onWake: () => void }) {
  const { now, hour24, tally, inks } = useWidgetEnv();
  const item = tally.item;
  const tick = useSecondTick(item?.countdown !== undefined);
  const nudge = glanceNudge(now);
  return (
    <View
      testID="glance"
      onPress={onWake}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: "#000000", alignItems: "center", justifyContent: "center" }}
    >
      <View style={{ flexDirection: "column", alignItems: "center", gap: 14, marginLeft: nudge.x * 2, marginTop: nudge.y * 2 }}>
        <Text style={{ fontSize: 120, color: "#8E8E8C" }}>{clockText(now, hour24)}</Text>
        {item ? (
          <View testID="glance-now" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: inks.tally }} />
            <Text style={{ fontSize: 14, fontWeight: "semibold", color: item.ink ? inks.dimmed[item.ink] : "#8E8E8C" }}>
              {(item.key.startsWith("event:") ? `Next ${onAirWords({ label: "" }, tick)}` : onAirWords(item, tick)).toUpperCase()}
            </Text>
            {tally.standby.length > 0 ? <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.3, borderColor: "#8E8E8C" }} /> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}
