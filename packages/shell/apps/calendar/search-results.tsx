/**
 * Edit › Find's answers, in a list under the toolbar's search field: each
 * event's day, time, and title in its calendar's color. ↑ ↓ move through
 * them in the field, Return or a click goes to the event, Esc ends the search.
 */

import { rowLook, SelectionBar, useColors, useSurface } from "@dashi/ui";
import { ScrollView, Text, View } from "@mirinjs/metal";
import type { ClockPrefs } from "../../src/clock.ts";
import { dayPart } from "./dates.ts";
import { occurrenceKey } from "./event-block.tsx";
import { clock, shortDay, titleOf } from "./format.ts";
import type { Occurrence } from "./types.ts";

export const RESULTS_WIDTH = 340;
const ROW = 30;

export function SearchResults({
  results,
  query,
  active,
  prefs,
  colorOf,
  top,
  onPick,
}: {
  results: readonly Occurrence[];
  query: string;
  /** The row ↑ ↓ are on. */
  active: number;
  prefs: ClockPrefs;
  colorOf: (calendarId: string) => string;
  /** Where the list starts, under the toolbar. */
  top: number;
  onPick: (occurrence: Occurrence) => void;
}) {
  const colors = useColors();
  const surface = useSurface();
  if (query.trim() === "") return null;
  return (
    <View
      testID="search-results"
      occlude
      style={{
        position: "absolute",
        right: 12,
        top,
        width: RESULTS_WIDTH,
        maxHeight: 360,
        flexDirection: "column",
        padding: 5,
        borderRadius: 12,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: "xl",
      }}
    >
      {results.length === 0 ? (
        <View style={{ height: ROW, justifyContent: "center", paddingHorizontal: 10 }}>
          <Text style={{ fontSize: 12, color: colors.textMuted }}>No events found</Text>
        </View>
      ) : (
        <ScrollView style={{ maxHeight: 350 }}>
          {results.map((occurrence, index) => {
            const look = rowLook(colors, index === active);
            return (
              <View
                key={occurrenceKey(occurrence)}
                testID={`result:${occurrenceKey(occurrence)}`}
                onPress={() => onPick(occurrence)}
                style={{
                  height: ROW,
                  flexShrink: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 10,
                  borderRadius: 7,
                  backgroundColor: look.ground,
                  hoverBackgroundColor: look.hover,
                }}
              >
                {index === active && <SelectionBar rowHeight={ROW} />}
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(occurrence.calendarId), flexShrink: 0 }} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, color: look.ink }}>
                    {titleOf(occurrence.event)}
                  </Text>
                </View>
                <View style={{ flexShrink: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 11, color: look.quiet }}>
                    {occurrence.event.allDay
                      ? shortDay(dayPart(occurrence.start), prefs)
                      : `${shortDay(dayPart(occurrence.start), prefs)}, ${clock(occurrence.start, prefs)}`}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}
