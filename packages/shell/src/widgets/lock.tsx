/**
 * The widgets on the lock screen (round five, frames 4, 13 and 14): a date
 * row with the weather inline, the clock stacked in two lines, a row of
 * compacts under it (Weather, Battery, what is next), the notifications as
 * counts only, Dashi's widgets on the left in the small size, and the Now
 * Bar over the password: the one thing on air, flooded. Private parts are
 * blanks unless allowed per widget; the month never marks busy days; a
 * press on anything asks for the password first and says what it will open.
 */

import { Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import { glyph, isGlyphName } from "../shared/inks/index.ts";
import { onAirWords, useSecondTick } from "../tally/index.ts";
import { Card } from "./card.tsx";
import { widgetInfo } from "./catalog.ts";
import { useWidgetEnv } from "./env.tsx";
import { SPANS, span } from "./layout.ts";
import { noticeCounts } from "./lib/counts.ts";
import { clockText, useSource } from "./lib/data.ts";
import { weatherLook } from "./lib/sources/weather.ts";
import { WidgetTile } from "./lib/views/widget.tsx";
import { Btn, Lab, NowTag, Num } from "./parts.tsx";
import type { Placement, WidgetKind, WidgetSize } from "./types.ts";

const INK = "#ECECEE";
const MUTED = "#ECECEEB3";

/** The lock's row under the clock: Dashi's three, in the compact size. */
export const LOCK_ROW: readonly WidgetKind[] = ["weather", "battery", "calendar"];
/** The side column: up to four of the person's widgets, small. */
export const LOCK_SIDE_MAX = 4;

/** Which of the person's widgets go in the side column: those that come in small, not the Rundown, not the row's, at most four. */
export function lockSide(placements: readonly Placement[]): Placement[] {
  return placements
    .filter(
      (each) => !LOCK_ROW.includes(each.kind) && each.kind !== "rundown" && (widgetInfo(each.kind)?.sizes.includes("small") ?? each.kind.startsWith("ext:")),
    )
    .slice(0, LOCK_SIDE_MAX)
    .map((each) => ({ ...each, size: "small" as WidgetSize }));
}

function DateRow({ now }: { now: number }) {
  const { hub } = useWidgetEnv();
  const weather = useSource(hub?.weather, { status: "loading" } as const);
  const day = new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
  return (
    <View testID="lock-date" style={{ flexDirection: "row", alignItems: "center", gap: 10, height: 18 }}>
      <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: INK }}>{day}</Text>
      {weather.status === "ok" || weather.status === "stale" ? (
        <>
          <Text style={{ fontSize: 12.5, color: MUTED }}>·</Text>
          <Svg markup={glyph(weatherLook(weather.now.code).glyph)} size={13} color={INK} />
          <Text style={{ fontSize: 12.5, fontWeight: "semibold", color: INK }}>{`${weather.now.place.toUpperCase()} ${weather.now.temperature}°`}</Text>
        </>
      ) : null}
    </View>
  );
}

/** The clock, its hours over its minutes (Metal draws Regular: Inter Display's thin cut waits on mirin, docs: for-mirin.md). */
function StackedClock({ now, hour24 }: { now: number; hour24: boolean }) {
  const [hours, minutes] = clockText(now, hour24).split(":");
  // Two lines of 120 points: the design's 196 on the laptop's 1029-point screen leaves no room on a smaller one.
  const line = (text: string) => <Text style={{ fontSize: 120, lineHeight: 112, color: INK }}>{hour24 ? text.padStart(2, "0") : text}</Text>;
  return (
    <View testID="lock-clock" style={{ flexDirection: "column", alignItems: "center" }}>
      {line(hours ?? "")}
      {line(minutes ?? "")}
    </View>
  );
}

export function LockHead() {
  const { now, hour24, hub } = useWidgetEnv();
  const counts = noticeCounts(useSource(hub?.notices, []));
  const width = span(SPANS.compact.cols);
  const height = span(SPANS.compact.rows);
  return (
    <View style={{ marginTop: 28, flexDirection: "column", alignItems: "center", gap: 12 }}>
      <DateRow now={now} />
      <StackedClock now={now} hour24={hour24} />
      <View testID="lock-row" style={{ flexDirection: "row", gap: 12 }}>
        {LOCK_ROW.map((kind) => (
          <WidgetTile key={kind} kind={kind} size="compact" width={width} height={height} air={false} testID={`lock-widget:${kind}`} />
        ))}
      </View>
      {counts.length > 0 ? (
        <View testID="lock-counts" style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
          {counts.slice(0, 4).map(({ app, count }) => (
            <Text key={app} style={{ fontSize: 13, color: INK }}>{`${app} ${count}`}</Text>
          ))}
          <Text style={{ fontSize: 12.5, color: MUTED }}>Unlock to read</Text>
        </View>
      ) : null}
    </View>
  );
}

/** How many of the side column's columns fit beside the clock's row on a screen `width` wide: two, one, or none. */
export function sideColumns(width: number): 0 | 1 | 2 {
  const row = 3 * span(SPANS.compact.cols) + 24;
  const room = (width - row) / 2 - 48;
  const small = span(SPANS.small.cols);
  return room >= 2 * small + 16 ? 2 : room >= small ? 1 : 0;
}

/** The side column, on the left: the person's widgets in small, two by two where the screen has room, else one column of two. */
export function LockSide({ placements, onPress }: { placements: readonly Placement[]; onPress: (placement: Placement) => void }) {
  const [width, setWidth] = useState(0);
  const columns = sideColumns(width);
  const side = lockSide(placements).slice(0, columns * 2);
  const size = span(SPANS.small.cols);
  return (
    <View style={{ position: "absolute", left: 0, top: 0, right: 0, height: 1 }} onLayout={(bounds) => setWidth(bounds.width)}>
      {columns === 0 ? null : <SideCards side={side} size={size} columns={columns} onPress={onPress} />}
    </View>
  );
}

function SideCards({ side, size, columns, onPress }: { side: readonly Placement[]; size: number; columns: 1 | 2; onPress: (placement: Placement) => void }) {
  return (
    <View testID="lock-side" style={{ position: "absolute", left: 48, top: 170, width: size * columns + 16 * (columns - 1), flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
      {side.map((each) => (
        <WidgetTile
          key={each.id}
          kind={each.kind}
          size="small"
          width={size}
          height={size}
          showPrivate={each.showPrivateWhenLocked === true}
          air={false}
          testID={`lock-widget:${each.id}`}
          onPress={() => onPress(each)}
        />
      ))}
    </View>
  );
}

/** The Now Bar: the one thing on air, flooded, over the password. A timer's pause and +1 work while locked (lock-safe, widgets/api.md § 6.2). */
export function NowBar() {
  const { tally, inks, hub } = useWidgetEnv();
  const item = tally.item;
  const timers = useSource(hub?.timers, []);
  const now = useSecondTick(item?.countdown !== undefined);
  if (!item) return null;
  const timer = timers.find((each) => `timer:${each.id}` === item.key);
  const words = onAirWords(item, now);
  const label = item.label.toUpperCase();
  const value = words.slice(item.label.length).trim();
  return (
    <View style={{ marginBottom: 28 }}>
      <Card look={{ inks, ink: item.ink, air: true, houseDown: false, redact: false }} width={580} height={68} compact padding={14} testID="now-bar">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14, flex: 1 }}>
          <NowTag tally={inks.tally} />
          <Svg markup={glyph(isGlyphName(item.glyph) ? item.glyph : "spark")} size={14} color={inks.onInk} />
          <Lab strong>{item.key.startsWith("event:") ? "Next" : label}</Lab>
          {value ? <Num value={value} size={36} /> : null}
          <View style={{ flex: 1 }} />
          {timer ? (
            <>
              <Btn
                icon={timer.endsAt === null ? "play" : "pause"}
                round
                onPress={() => (timer.endsAt === null ? hub?.timers.resume(timer.id) : hub?.timers.pause(timer.id))}
                testID="now-bar-pause"
              />
              <Btn icon="plus" round onPress={() => hub?.timers.addMinute(timer.id)} testID="now-bar-more" />
            </>
          ) : null}
        </View>
      </Card>
    </View>
  );
}
