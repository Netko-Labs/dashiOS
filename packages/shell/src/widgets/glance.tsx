/**
 * Glance (round five, frames 7 and 14; lock-v3 C and #narrow, LK-3, D803, D806): the lock screen at rest.
 * Black whatever the mode, in Dark's inks: the split lock's left half (the day and the clock, hours over
 * minutes, where the lock has them, on any screen size) and Today folded into words where Today is (the
 * pane's place, or under the left half on a screen taller than wide): what is on air as one line, then the
 * counts. Its content moves a few points each minute so no pixel burns in; any key or press wakes the
 * lock screen as it was.
 */

import { lockLayout, TRUE_BLACK } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { useWidgetEnv } from "./env.tsx";
import { SplitGlance } from "./lib/glance-split.tsx";

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

export function Glance({ onWake, day = "", eventsShown = true }: { onWake: () => void; day?: string; eventsShown?: boolean }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { now } = useWidgetEnv();
  const measure = (bounds: { width: number; height: number }) => setSize({ width: bounds.width, height: bounds.height });
  return (
    <View
      testID="glance"
      onPress={onWake}
      onLayout={measure}
      style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0, backgroundColor: TRUE_BLACK.ground }}
    >
      {size.width > 0 ? <SplitGlance day={day} layout={lockLayout(size.width, size.height)} nudge={glanceNudge(now)} eventsShown={eventsShown} /> : null}
    </View>
  );
}
