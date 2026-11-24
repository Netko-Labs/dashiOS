/** Calendar (miso): today's date large and what is next; on the lock screen, the events are blanks and the month has no busy marks (#27). */

import { SPACE, TYPE, WEIGHT, weekdayLetters } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { instantOf, type Occurrence } from "../../../shared/calendar/index.ts";
import { firstDayIndex, useClockPrefs } from "../../../shared/time/index.ts";
import { useWidgetEnv } from "../../env.tsx";
import { useCard } from "../../look.tsx";
import { Grow, Head, Lab, Meta, Num, Private, Rule, Title, VRule, Words } from "../../parts.tsx";
import type { WidgetSize } from "../../types.ts";
import { clockText } from "../data.ts";

const startOf = (occurrence: Occurrence): number => instantOf(occurrence.start).getTime();

/** "in 58 min", "in 2 h", "now". */
export function inWords(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  if (minutes <= 0) return "now";
  return minutes < 90 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`;
}

/**
 * The month, its week from the region's first day (UI-14); it never marks busy days (the area has the
 * Calendar widget's own list, and the lock screen must not, #27).
 */
function MonthGrid({ now, cell }: { now: number; cell: number }) {
  const c = useCard();
  const prefs = useClockPrefs();
  const firstDay = firstDayIndex(prefs.locale, prefs.firstWeekday);
  const date = new Date(now);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const lead = (first.getDay() - firstDay + 7) % 7;
  const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const rows: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  const today = date.getDate();
  return (
    <View style={{ flexDirection: "column" }}>
      <View style={{ flexDirection: "row" }}>
        {weekdayLetters(firstDay, prefs.locale).map((d, i) => (
          <View key={`${d}${i}`} style={{ width: cell, alignItems: "center" }}>
            <Text style={{ fontSize: TYPE.inks.label.size, fontWeight: WEIGHT.semibold, color: c.tertiary }}>{d}</Text>
          </View>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={String(r)} style={{ flexDirection: "row", height: cell - 2 }}>
          {row.map((day, i) => (
            <View key={String(i)} style={{ width: cell, alignItems: "center", justifyContent: "center" }}>
              {day === null ? null : day === today ? (
                <View
                  style={{
                    width: cell - 3,
                    height: cell - 3,
                    borderRadius: (cell - 3) / 2,
                    backgroundColor: c.value,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: TYPE.inks.small.size, fontWeight: WEIGHT.bold, color: c.onFill }}>{String(day)}</Text>
                </View>
              ) : (
                <Text style={{ fontSize: TYPE.inks.small.size, color: day < today ? c.tertiary : c.ink }}>{String(day)}</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

export function CalendarWidget({ size }: { size: WidgetSize }) {
  const { hub, now, hour24 } = useWidgetEnv();
  const upcoming = (hub?.occurrences() ?? []).filter((each) => !each.event.allDay && startOf(each) + 60_000 > now);
  const next = upcoming[0] ?? null;
  const day = new Date(now);
  const weekday = day.toLocaleDateString(undefined, { weekday: "long" });
  if (size === "compact") return <CompactNext next={next} now={now} hour24={hour24} />;
  if (size === "large")
    return (
      <>
        <Head left={<Lab>{day.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Lab>} />
        <View style={{ flexDirection: "row", gap: SPACE.page, marginTop: SPACE.inset }}>
          <MonthGrid now={now} cell={23} />
          <View style={{ flexDirection: "column", gap: SPACE.s, flex: 1 }}>
            <Num value={String(day.getDate())} size={84} />
            <Lab>{weekday}</Lab>
          </View>
        </View>
        <Grow />
        <EventRows events={upcoming.slice(0, 3)} hour24={hour24} />
      </>
    );
  if (size === "wide") {
    const minutes = next ? Math.max(1, Math.round((startOf(next) - now) / 60_000)) : 0;
    return (
      <>
        <Head left={<Lab>Up next</Lab>} right={<Meta>{`${upcoming.length} ahead`}</Meta>} />
        <View style={{ flexDirection: "row", gap: SPACE.button, flex: 1, marginTop: SPACE.gap }}>
          <View style={{ flexDirection: "column", width: 112 }}>
            {next ? (
              <Num
                value={minutes > 99 ? String(Math.round(minutes / 60)) : String(minutes)}
                unit={minutes > 99 ? "h" : "min"}
                size={64}
                weight={1 - Math.min(60, minutes) / 60}
              />
            ) : (
              <Num value={String(day.getDate())} size={64} />
            )}
            <Lab>{next ? `to ${clockText(startOf(next), hour24)}` : weekday}</Lab>
          </View>
          <VRule margin={0} />
          <View style={{ flex: 1 }}>
            <EventRows events={upcoming.slice(0, 3)} hour24={hour24} />
          </View>
        </View>
      </>
    );
  }
  return (
    <>
      <Head left={<Lab>{weekday}</Lab>} right={<Meta>{day.toLocaleDateString(undefined, { month: "short" })}</Meta>} />
      <Grow />
      <Num value={String(day.getDate())} size={76} />
      <Grow />
      {next ? (
        <>
          <Private what="Event" width={110}>
            <Title>{next.event.title || "Event"}</Title>
          </Private>
          <Words>{`${clockText(startOf(next), hour24)} · ${inWords(startOf(next), now)}`}</Words>
        </>
      ) : (
        <Words>Nothing else today</Words>
      )}
    </>
  );
}

function EventRows({ events, hour24 }: { events: readonly Occurrence[]; hour24: boolean }) {
  if (events.length === 0) return <Words>Nothing else today</Words>;
  return (
    <View style={{ flexDirection: "column" }}>
      {events.map((event, i) => (
        <View key={`${event.event.uid}${event.start}`} style={{ flexDirection: "column" }}>
          {i ? <Rule /> : null}
          <View style={{ flexDirection: "column", paddingTop: SPACE.s, paddingBottom: SPACE.s }}>
            <Private what="Event" width={120}>
              <Title weight={i ? "500" : "semibold"}>{event.event.title || "Event"}</Title>
            </Private>
            <Meta>{[clockText(startOf(event), hour24), event.event.location].filter(Boolean).join(" · ")}</Meta>
          </View>
        </View>
      ))}
    </View>
  );
}

/** The lock's row, and a compact anywhere: the next event's time, its title a blank while locked. */
function CompactNext({ next, now, hour24 }: { next: Occurrence | null; now: number; hour24: boolean }) {
  return (
    <>
      <Head left={<Lab>Next</Lab>} right={next?.event.location ? <Meta>{next.event.location}</Meta> : undefined} />
      <Grow />
      <View style={{ flexDirection: "row", gap: SPACE.m, alignItems: "flex-end" }}>
        <Num value={next ? clockText(startOf(next), hour24) : String(new Date(now).getDate())} size={30} />
        {next ? (
          <Private what="Event" width="fill">
            <Words ink max={10}>
              {next.event.title || "Event"}
            </Words>
          </Private>
        ) : (
          <Words>Nothing else</Words>
        )}
      </View>
    </>
  );
}
