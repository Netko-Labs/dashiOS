/**
 * The one progress control (docs/design.html, PA-5), as a bar or a spinner.
 * A bar with a `value` fills to it, in ink on its track (Q3: never the
 * accent); without one (`null`) an ink segment
 * slides across and back, so a wait that can't say how long still shows it
 * is working. The spinner is for a wait with nothing to measure, in a row or
 * beside a word. `Loading` stands in for content that is on its way, and
 * shows only after 200 ms: until then the old content (or nothing) stays.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { clampFraction, PROGRESS_TICK_MS, SEGMENT, SPOKES, SWEEP_TICKS, spinnerMarkup, sweepOffset } from "./progress-math.ts";
import { DELAY, pill, SPACE, TYPE, useColors } from "./theme/index.ts";

/** How long a wait goes unshown (PA-5). */
export const LOADING_DELAY_MS = DELAY.wait;

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

/** The bar's heights: small in a row or a card, regular on its own. */
export const PROGRESS_BAR = { small: 4, regular: 6 } as const;

export interface ProgressBarProps {
  /** 0 to 1; `null` when how much is done isn't known. */
  value: number | null;
  /** Pixels; fills its row by default. */
  width?: number;
  /** `small` (4 tall) in a row or a card; `regular` (6) on its own in a dialog or a page. */
  size?: "small" | "regular";
  testID?: string;
  /** What is going on, for screen readers ("Downloading Notes"); the share done is said after it. */
  label?: string;
}

export function ProgressBar({ value, width, size = "small", testID = "progress", label }: ProgressBarProps) {
  const colors = useColors();
  const tick = useTick(value === null, SWEEP_TICKS);
  const height = size === "small" ? PROGRESS_BAR.small : PROGRESS_BAR.regular;
  // In shares of the track, so the bar needs no measuring: a spacer, then the lit part.
  const before = value === null ? sweepOffset(tick, 1000) / 10 : 0;
  const lit = value === null ? SEGMENT * 100 : clampFraction(value) * 100;
  return (
    <View
      testID={testID}
      accessibilityRole="status"
      accessibilityLabel={[label, value === null ? "In progress" : `${Math.round(clampFraction(value) * 100)}%`].filter(Boolean).join(", ")}
      style={{
        ...(width !== undefined ? { width } : { flex: 1 }),
        height,
        flexShrink: 0,
        flexDirection: "row",
        borderRadius: pill(height),
        backgroundColor: colors.track,
        overflow: "hidden",
      }}
    >
      <View style={{ width: `${before}%`, flexShrink: 0 }} />
      {lit > 0 && <View style={{ width: `${lit}%`, minWidth: height, flexShrink: 0, borderRadius: pill(height), backgroundColor: colors.text }} />}
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

/**
 * Content on its way (PA-5): after 200 ms, a spinner and the word for it
 * ("Loading…", or what it looks for: "Searching…"); nothing before. Centered
 * in what it stands for, or `inline` in a row or under a field.
 */
export function Loading({ label = "Loading…", inline, testID = "loading" }: { label?: string; inline?: boolean; testID?: string }) {
  const colors = useColors();
  const shown = useShownAfter(true);
  return (
    <View
      testID={testID}
      accessibilityRole="status"
      accessibilityLabel={label}
      style={{
        ...(inline ? { flexShrink: 0 } : { flex: 1, justifyContent: "center", padding: SPACE.xl }),
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.m,
      }}
    >
      {shown && (
        <>
          <Spinner size={16} testID={`${testID}:spinner`} />
          <Text style={{ fontSize: inline ? TYPE.secondary.size : TYPE.body.size, color: colors.textMuted }}>{label}</Text>
        </>
      )}
    </View>
  );
}
