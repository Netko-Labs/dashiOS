/**
 * Edit › Find's answers, in a list under the search field in the title's place: each
 * event's day, time, and title in its calendar's color. ↑ ↓ move through
 * them in the field, Return or a click goes to the event, Esc ends the search.
 */

import { rowLook, SelectionBar, useColors, useSurface } from "@dashi/ui";
import { type Bounds, ScrollView, Text, View } from "@mirinjs/metal";
import { dayPart, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { clock, shortDay, titleOf } from "../format.ts";
import { occurrenceKey } from "../grid/event-block.tsx";

export const RESULTS_WIDTH = 340;
const ROW = 30;
/** Where the answers start when Find's field has not been laid out yet: under the toolbar, at the window's right. */
const FALLBACK = { top: 42, right: 12 } as const;

/** Where the answers hang: under Find's field, from its left edge, kept 12 inside the window. */
export function resultsPlace(field: Bounds | null, windowWidth: number): { top: number; left: number; width: number } {
  const width = Math.min(RESULTS_WIDTH, Math.max(0, windowWidth - 24));
  if (field === null) return { top: FALLBACK.top, left: Math.max(12, windowWidth - FALLBACK.right - width), width };
  return { top: Math.round(field.y + field.height + 6), left: Math.round(Math.max(12, Math.min(field.x, windowWidth - 12 - width))), width };
}

function ResultRow({
  occurrence,
  active,
  prefs,
  color,
  onPress,
}: {
  occurrence: Occurrence;
  active: boolean;
  prefs: ClockPrefs;
  color: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const look = rowLook(colors, active);
  return (
    <View
      testID={`result:${occurrenceKey(occurrence)}`}
      onPress={onPress}
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
      {active && <SelectionBar rowHeight={ROW} />}
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, flexShrink: 0 }} />
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
}

export function SearchResults({
  results,
  query,
  active,
  prefs,
  colorOf,
  place,
  onPick,
}: {
  results: readonly Occurrence[];
  query: string;
  /** The row ↑ ↓ are on. */
  active: number;
  prefs: ClockPrefs;
  colorOf: (calendarId: string) => string;
  /** Where the list hangs (`resultsPlace`). */
  place: { top: number; left: number; width: number };
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
        left: place.left,
        top: place.top,
        width: place.width,
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
          {results.map((occurrence, index) => (
            <ResultRow
              key={occurrenceKey(occurrence)}
              occurrence={occurrence}
              active={index === active}
              prefs={prefs}
              color={colorOf(occurrence.calendarId)}
              onPress={() => onPick(occurrence)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}
