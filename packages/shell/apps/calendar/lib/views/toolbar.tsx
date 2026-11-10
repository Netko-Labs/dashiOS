/**
 * Calendar's toolbar: previous / Today / next, Day / Week / Month (one
 * pop-up in a narrow window), Find and +; and what stands in the title's
 * place: the period shown, or Find's field.
 */

import { PopUpButton, SEARCH, SearchField, Segmented, ToolbarButton, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import type { Day } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { type CalendarChrome, VIEW_POPUP_WIDTH } from "../chrome.ts";
import { shortViewTitle, viewTitle } from "../format.ts";
import { CHEVRON_LEFT, CHEVRON_RIGHT, PLUS } from "../glyphs.ts";
import type { Find } from "../hooks/use-find.ts";
import type { View as ViewName } from "../layout.ts";
import type { CalendarModel } from "../model.ts";
import type { CalendarState } from "../state.ts";

const VIEW_OPTIONS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

export function TodayButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    // A Tab stop between ‹ and › (KB-1); Space or Return goes to today.
    <View
      testID="today"
      focusable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        height: 28,
        paddingHorizontal: 12,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.button,
        hoverBackgroundColor: colors.separator,
        focusRingColor: colors.focusRing,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.text }}>Today</Text>
    </View>
  );
}

/** The period shown, in full and short; the short form is for a narrow window. */
export function headingOf(state: CalendarState, days: readonly Day[], prefs: ClockPrefs): { title: string; short: string } {
  const { view, anchor } = state;
  return { title: viewTitle(view, anchor, days, prefs), short: shortViewTitle(view, anchor, days, prefs) };
}

export function CalendarToolbar({
  model,
  state,
  chrome,
  find,
  newEvent,
}: {
  model: CalendarModel;
  state: CalendarState;
  chrome: CalendarChrome;
  find: Find;
  newEvent: () => void;
}) {
  const { view } = state;
  return (
    <>
      <ToolbarButton testID="previous" glyph={CHEVRON_LEFT} tooltip={`Previous ${view}`} onPress={() => model.step(-1)} />
      <TodayButton onPress={() => model.goToday()} />
      <ToolbarButton testID="next" glyph={CHEVRON_RIGHT} tooltip={`Next ${view}`} onPress={() => model.step(1)} />
      {chrome.compact ? (
        <View style={{ width: VIEW_POPUP_WIDTH, flexShrink: 0 }}>
          <PopUpButton testID="view" options={VIEW_OPTIONS} value={view} onChange={(next: ViewName) => model.setView(next)} width={VIEW_POPUP_WIDTH} />
        </View>
      ) : (
        <Segmented testID="view" options={VIEW_OPTIONS} value={view} onChange={(next: ViewName) => model.setView(next)} segmentWidth={52} />
      )}
      <ToolbarButton
        testID="find-button"
        glyph={SEARCH}
        tooltip={find.search ? "Close Find" : "Find events"}
        onPress={() => (find.search ? find.close() : find.setSearch({ query: "", active: 0 }))}
      />
      <ToolbarButton testID="new-event" glyph={PLUS} tooltip="New event" disabled={state.calendars.length === 0} onPress={newEvent} />
    </>
  );
}

/**
 * The period shown, or Find's field, in the title's place: opening Find moves
 * no control. The title takes the room the controls leave and ends in an
 * ellipsis; a narrow window shows its short form.
 */
export function ToolbarCenter({ heading, chrome, find }: { heading: { title: string; short: string }; chrome: CalendarChrome; find: Find }) {
  const colors = useColors();
  const { search, findAt, results } = find;
  if (search) {
    return (
      <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
        <View
          onLayout={(bounds) => {
            if (findAt === null || bounds.x !== findAt.x || bounds.y !== findAt.y || bounds.width !== findAt.width) find.setFindAt(bounds);
          }}
          style={{ flex: 1, minWidth: 0, maxWidth: 260, flexDirection: "row" }}
        >
          <SearchField
            testID="find"
            value={search.query}
            placeholder="Find events"
            autoFocus
            width={260}
            minWidth={96}
            onChangeText={(query) => find.setSearch({ query, active: 0 })}
            onSubmit={() => find.pickResult(results[search.active])}
            onKeyPress={(key) => {
              if (key === "Escape") find.close();
              else find.setSearch({ ...search, active: Math.max(0, Math.min(results.length - 1, search.active + (key === "ArrowDown" ? 1 : -1))) });
            }}
          />
        </View>
      </View>
    );
  }
  return (
    <View testID="window-title" style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" }}>
      <View style={{ flexShrink: 1, minWidth: 0, maxWidth: 320 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: "bold", color: colors.text }}>
          {chrome.compact ? heading.short : heading.title}
        </Text>
      </View>
    </View>
  );
}
