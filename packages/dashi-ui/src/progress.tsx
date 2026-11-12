/**
 * The one progress control (docs/design.html, PA-5), as a bar or a spinner.
 * A bar with a `value` fills to it; without one (`null`) a kombu segment
 * slides across and back, so a wait that can't say how long still shows it
 * is working. The spinner is for a wait with nothing to measure, in a row or
 * beside a word. `Loading` stands in for content that is on its way, and
 * shows only after 200 ms: until then the old content (or nothing) stays.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { clampFraction, PROGRESS_TICK_MS, SEGMENT, SPOKES, SWEEP_TICKS, spinnerMarkup, sweepOffset } from "./progress-math.ts";
import { useColors } from "./theme/index.ts";

/** How long a wait goes unshown (PA-5). */
export const LOADING_DELAY_MS = 200;

/** A counter that steps every tick while `running`, through `period` values. */
function useTick(running: boolean, period: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((now) => (now + 1) % period), PROGRESS_TICK_MS);
    return () => clearInterval(timer);
  }, [running, period]);
  return tick;
}

/** True once `active` has held for `ms`; false again as soon as it stops. */
export function useShownAfter(active: boolean, ms: number = LOADING_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && shown;
}

export interface ProgressBarProps {
  /** 0 to 1; `null` when how much is done isn't known. */
  value: number | null;
  /** Pixels; fills its row by default. */
  width?: number;
  /** `small` (4 tall) in a row or a card; `regular` (6) on its own in a dialog or a page. */
  size?: "small" | "regular";
  testID?: string;
}

export function ProgressBar({ value, width, size = "small", testID = "progress" }: ProgressBarProps) {
  const colors = useColors();
  const tick = useTick(value === null, SWEEP_TICKS);
  const height = size === "small" ? 4 : 6;
  // In shares of the track, so the bar needs no measuring: a spacer, then the lit part.
  const before = value === null ? sweepOffset(tick, 1000) / 10 : 0;
  const lit = value === null ? SEGMENT * 100 : clampFraction(value) * 100;
  return (
    <View
      testID={testID}
      style={{
        ...(width !== undefined ? { width } : { flex: 1 }),
        height,
        flexShrink: 0,
        flexDirection: "row",
        borderRadius: height / 2,
        backgroundColor: colors.track,
        overflow: "hidden",
      }}
    >
      <View style={{ width: `${before}%`, flexShrink: 0 }} />
      {lit > 0 && <View style={{ width: `${lit}%`, minWidth: height, flexShrink: 0, borderRadius: height / 2, backgroundColor: colors.selection }} />}
    </View>
  );
}

/** Spokes turning: a wait with nothing to measure. 16 beside a word, 24 or 32 on its own. */
export function Spinner({ size = 16, testID = "spinner" }: { size?: number; testID?: string }) {
  const colors = useColors();
  const tick = useTick(true, SPOKES);
  return (
    <View testID={testID} style={{ width: size, height: size, flexShrink: 0 }}>
      <Svg markup={spinnerMarkup(tick)} size={size} color={colors.textMuted} />
    </View>
  );
}

/** Content on its way: after 200 ms, a spinner and the word for it, centered; nothing before. */
export function Loading({ label = "Loading…", testID = "loading" }: { label?: string; testID?: string }) {
  const colors = useColors();
  const shown = useShownAfter(true);
  return (
    <View testID={testID} style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 24 }}>
      {shown && (
        <>
          <Spinner size={16} testID={`${testID}:spinner`} />
          <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
        </>
      )}
    </View>
  );
}
