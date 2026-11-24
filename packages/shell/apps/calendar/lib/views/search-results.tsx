/**
 * Edit › Find's answers, in a list under the search field in the title's place: each
 * event's day, time, and title by its calendar's colour. What hangs under a field is
 * a menu (LA-4): MENU's measures, its edge and shadow, the row ↑ ↓ are on in the
 * menu's highlight; nothing found says "No results" in its one row (PA-17). ↑ ↓ move through
 * them in the field, Return or a click goes to the event, Esc ends the search.
 */

import { MENU, menuHighlight, pill, SHADOW, SPACE, TYPE, useColors, useSurface } from "@dashi/ui";
import { type Bounds, ScrollView, Text, View } from "@mirinjs/metal";
import { dayPart, type Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { clock, shortDay, titleOf } from "../format.ts";
import { occurrenceKey } from "../grid/event-block.tsx";

export const RESULTS_WIDTH = 340;
/** The list's most height, and a calendar's dot before each title. */
const RESULTS_HEIGHT = 360;
const DOT = 8;
/** Where the answers start when Find's field has not been laid out yet: under the toolbar, at the window's right. */
const FALLBACK = { top: 42, right: SPACE.inset } as const;

/** Where the answers hang: under Find's field, from its left edge, kept 12 inside the window. */
export function resultsPlace(field: Bounds | null, windowWidth: number): { top: number; left: number; width: number } {
  const width = Math.min(RESULTS_WIDTH, Math.max(0, windowWidth - 2 * SPACE.inset));
  if (field === null) return { top: FALLBACK.top, left: Math.max(SPACE.inset, windowWidth - FALLBACK.right - width), width };
  return {
    top: Math.round(field.y + field.height + MENU.margin),
    left: Math.round(Math.max(SPACE.inset, Math.min(field.x, windowWidth - SPACE.inset - width))),
    width,
  };
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
  const lit = menuHighlight(null, colors.selection, colors.onAccent);
  return (
    <View
      testID={`result:${occurrenceKey(occurrence)}`}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={{
        height: MENU.row,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: SPACE.m,
        paddingHorizontal: MENU.inset,
        borderRadius: MENU.rowRadius,
        backgroundColor: active ? lit.fill : colors.menu,
        hoverBackgroundColor: active ? lit.fill : colors.button,
      }}
    >
      <View style={{ width: DOT, height: DOT, borderRadius: pill(DOT), backgroundColor: color, flexShrink: 0 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.body.size, color: active ? lit.ink : colors.text }}>
          {titleOf(occurrence.event)}
        </Text>
      </View>
      <View style={{ flexShrink: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: active ? lit.keysInk : colors.textMuted }}>
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
      accessibilityRole="menu"
      style={{
        position: "absolute",
        left: place.left,
        top: place.top,
        width: place.width,
        maxHeight: RESULTS_HEIGHT,
        flexDirection: "column",
        borderRadius: MENU.radius,
        backgroundColor: surface.card,
        borderWidth: MENU.edge,
        borderColor: colors.menuEdge,
        shadow: SHADOW.xl,
      }}
    >
      <View style={{ flexDirection: "column", padding: MENU.padding, borderRadius: MENU.radius - MENU.edge, backgroundColor: colors.menu }}>
        {results.length === 0 ? (
          <View testID="no-results" style={{ height: MENU.row, justifyContent: "center", paddingHorizontal: MENU.inset }}>
            <Text style={{ fontSize: TYPE.body.size, color: colors.textMuted }}>No results</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: RESULTS_HEIGHT - 2 * (MENU.padding + MENU.edge) }}>
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
    </View>
  );
}
