/**
 * The one clock of the lock screen, the login screen and Glance (TY-1,
 * the owner's Q1, decisions.md D670): 120 Inter Display ExtraLight, its hours
 * over its minutes. Over it on the lock and the login screen, the day in
 * the Inks' body size, upper case as a style on the shared formatter's
 * string (PA-14), with whatever the host puts after it (the lock's
 * weather). Inter Display and the light weights only where the Metal host
 * says it draws them (`display`); an older host refuses a tree that asks,
 * so there the clock is Regular.
 */

import { Text, type TextStyle, View } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { SPACE, TYPE, WEIGHT } from "./theme/measures.ts";

/** The clock's face: Inter Display ExtraLight, or the default face on a host that cannot draw it. */
export function clockFace(display: boolean): Pick<TextStyle, "fontFamily" | "fontWeight"> {
  return display ? { fontFamily: "display", fontWeight: WEIGHT.display.extraLight } : {};
}

/** The hours and the minutes of a formatted time ("5:04", "17.04"); null when it has no two numbers. */
export function clockParts(time: string): [string, string] | null {
  const match = /^\s*(\d+)\D+(\d+)/.exec(time);
  return match?.[1] && match[2] ? [match[1], match[2]] : null;
}

/** The day's row: its height, and the room between its words (the lock's "·" and weather). */
export const CLOCK_DAY = { height: 18, gap: SPACE.gap } as const;

export interface InksClockProps {
  /** The time as the host formats it, without AM or PM: "5:04", "17:04". */
  time: string;
  color: string;
  /** The host draws Inter Display and the light weights (its `protocol` line says `fontWeights` and `displayFont`). */
  display: boolean;
  testID?: string;
}

/** Hours over minutes, 120 on a 112 line. A time that does not split is one line. */
export function InksClock({ time, color, display, testID }: InksClockProps): ReactNode {
  const parts = clockParts(time) ?? [time];
  const style = { fontSize: TYPE.clock.size, lineHeight: TYPE.clock.line, color, ...clockFace(display) };
  return (
    <View {...(testID ? { testID } : {})} style={{ flexDirection: "column", alignItems: "center" }}>
      {parts.map((part, at) => (
        <Text key={at === 0 ? "hours" : "minutes"} style={style}>
          {part}
        </Text>
      ))}
    </View>
  );
}

export interface ClockHeadProps {
  /** The day as the host's shared formatter writes it ("Sunday, November 1"); shown upper case. */
  day: string;
  time: string;
  ink: string;
  display: boolean;
  /** After the day, on its row: the lock's weather. */
  after?: ReactNode;
  /** Under the clock: the lock's row of widgets and its counts. */
  children?: ReactNode;
  testID?: string;
}

/** The head both screens share: the day's row, the clock, and what the host hangs under it. */
export function ClockHead({ day, time, ink, display, after, children, testID }: ClockHeadProps): ReactNode {
  return (
    <View {...(testID ? { testID } : {})} style={{ marginTop: SPACE.xl, flexDirection: "column", alignItems: "center", gap: SPACE.inset }}>
      <View testID="clock-day" style={{ flexDirection: "row", alignItems: "center", gap: CLOCK_DAY.gap, height: CLOCK_DAY.height }}>
        <Text style={{ fontSize: TYPE.inks.body.size, fontWeight: WEIGHT.semibold, color: ink }}>{day.toLocaleUpperCase()}</Text>
        {after}
      </View>
      <InksClock time={time} color={ink} display={display} testID="clock" />
      {children}
    </View>
  );
}
