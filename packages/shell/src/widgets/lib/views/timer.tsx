/** Timer (wakame): the time left large, thickening as it nears zero (#14); Pause, +1 min, and a quick start when none runs. */

import { SPACE } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { DotRow } from "../../../shared/inks/index.ts";
import { countdownText, useSecondTick } from "../../../tally/index.ts";
import { useWidgetEnv } from "../../env.tsx";
import { useCard } from "../../look.tsx";
import { Btn, Grow, Head, Lab, Meta, NowTag, Num, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { clockText, useSource } from "../data.ts";
import { type Timer, timeLeft } from "../sources/timer.ts";

/** Presets a press starts. */
export const QUICK_TIMERS = [3, 5, 10, 25] as const;

/** A timer's card, in the column or as a live card: the 1 Hz tick redraws this card only. */
export function TimerFace({ timer, size, air, live }: { timer: Timer; size: WidgetSize; air: boolean; live?: boolean }) {
  const { hub, hour24, inks } = useWidgetEnv();
  const c = useCard();
  const now = useSecondTick(timer.endsAt !== null);
  const left = timeLeft(timer, now);
  const share = timer.total > 0 ? left / timer.total : 0;
  const weight = 1 - Math.min(1, left / 300_000);
  const timers = hub?.timers;
  const pause = timer.endsAt === null ? () => timers?.resume(timer.id) : () => timers?.pause(timer.id);
  const done = left === 0 && timer.endsAt !== null;
  const text = countdownText(timer.endsAt ?? now + left, now);
  const ends = timer.endsAt === null ? "paused" : done ? "done" : `ends ${clockText(timer.endsAt, hour24)}`;
  const buttons = done ? (
    <>
      <Btn label="Stop" fill={!air} onPress={() => timers?.stop(timer.id)} testID="timer-stop" />
      <Btn label="+1 min" onPress={() => timers?.addMinute(timer.id)} />
    </>
  ) : (
    <>
      <Btn icon={timer.endsAt === null ? "play" : "pause"} label={timer.endsAt === null ? "Resume" : "Pause"} onPress={pause} testID="timer-pause" />
      <Btn label="+1 min" onPress={() => timers?.addMinute(timer.id)} testID="timer-more" />
    </>
  );
  if (live || size === "wide")
    return (
      <View style={{ flexDirection: "column", gap: SPACE.s }}>
        <Head
          left={
            <View style={{ flexDirection: "row", gap: SPACE.m, alignItems: "center" }}>
              <Lab>{timer.label === "Timer" ? "Timer" : `Timer · ${timer.label}`}</Lab>
              <Meta>{ends}</Meta>
            </View>
          }
          right={air ? <NowTag tally={inks.tally} /> : null}
        />
        <View style={{ flexDirection: "row", gap: SPACE.button, alignItems: "flex-end" }}>
          <Num value={countdownText(timer.endsAt ?? now + left, now)} size={46} weight={weight} />
          <View style={{ flex: 1, flexDirection: "column", gap: SPACE.m }}>
            <DotRow count={28} value={share} pitch={7.1} radius={0.32} lit={c.value} unlit={c.off} />
            <View style={{ flexDirection: "row", gap: SPACE.s }}>
              {buttons}
              <Grow />
              <Btn icon="x" round onPress={() => timers?.stop(timer.id)} testID="timer-close" />
            </View>
          </View>
        </View>
      </View>
    );
  return (
    <>
      <Head left={<Lab>{timer.label}</Lab>} right={air ? <NowTag tally={inks.tally} /> : <Meta>{ends}</Meta>} />
      <Grow />
      <Num value={text} size={size === "compact" ? 40 : text.length > 4 ? 48 : 64} weight={weight} />
      {size === "compact" ? null : (
        <>
          <Grow />
          <DotRow count={20} value={share} pitch={7.2} radius={0.32} lit={c.value} unlit={c.off} />
          <View style={{ flexDirection: "row", gap: SPACE.s, marginTop: SPACE.gap }}>{buttons}</View>
        </>
      )}
    </>
  );
}

export function TimerWidget({ size }: { size: WidgetSize }) {
  const { hub } = useWidgetEnv();
  const timers = useSource(hub?.timers, []);
  const shown = timers.at(-1);
  // A running timer is the live card at the top of the area: it is on air there, not here too.
  if (shown) return <TimerFace timer={shown} size={size} air={false} />;
  // Compact is one row of cells: no room for a line of its own over the buttons, so "Start one" sits in the head.
  const compact = size === "compact";
  return (
    <>
      <Head left={<Lab>Timer</Lab>} right={compact ? <Meta>Start one</Meta> : null} />
      <Grow />
      {compact ? null : <Words>Start one</Words>}
      <View style={{ flexDirection: "row", gap: SPACE.s, ...(compact ? {} : { marginTop: SPACE.m }), flexWrap: "wrap" }}>
        {QUICK_TIMERS.slice(0, compact ? 2 : 4).map((minutes) => (
          <Btn key={minutes} label={`${minutes} min`} onPress={() => hub?.timers.start("Timer", minutes)} testID={`timer-start:${minutes}`} />
        ))}
      </View>
    </>
  );
}
