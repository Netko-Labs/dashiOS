/**
 * The sidebar: the mini month, the calendars with their colors and
 * checkboxes, and New Calendar and Import. The checkbox shows or hides a
 * calendar; pressing the row picks it as the one new events go to (it is
 * lit), so hiding one takes aiming. The month and the calendars scroll in a
 * short window; Import and New calendar stay at its foot. In a narrow window
 * it is a rail (`CalendarRail`): each calendar's dot shows or hides it, and
 * names itself after a rest.
 */

import { CHECK, rowLook, SelectionBar, SidebarSection, useColors, useTooltip } from "@dashi/ui";
import { ScrollView, Svg, Text, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Calendar } from "../../../../src/shared/calendar/index.ts";
import { ELLIPSIS, IMPORT, PLUS } from "../glyphs.ts";
import { MiniMonth, type MiniMonthProps } from "./mini-month.tsx";

export interface SidebarProps extends MiniMonthProps {
  calendars: readonly Calendar[];
  hidden: readonly string[];
  onToggle: (id: string) => void;
  /** The calendar new events go to, lit; null when none shows. */
  target: string | null;
  onChoose: (id: string) => void;
  onMenu: (calendar: Calendar, x: number, y: number) => void;
  onNewCalendar: () => void;
  onImport: () => void;
}

function CalendarRow({
  calendar,
  visible,
  chosen,
  onToggle,
  onChoose,
  onMenu,
}: {
  calendar: Calendar;
  visible: boolean;
  chosen: boolean;
  onToggle: () => void;
  onChoose: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const colors = useColors();
  // The "⋯" shows while the pointer is on the row (or it is the one picked), not on every row at rest.
  const [hovered, setHovered] = useState(false);
  return (
    // The whole row picks the calendar; the check and the menu inside it take their own presses
    // (Metal gives a press to the innermost view that handles it).
    <View
      testID={`calendar-row:${calendar.id}`}
      onPress={onChoose}
      onContextMenu={(event) => onMenu(event.x, event.y)}
      onHoverChange={setHovered}
      style={{
        height: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 8,
        borderRadius: 7,
        backgroundColor: rowLook(colors, chosen).ground,
        hoverBackgroundColor: rowLook(colors, chosen).hover,
      }}
    >
      {chosen && <SelectionBar rowHeight={28} />}
      <View
        testID={`calendar-check:${calendar.id}`}
        onPress={onToggle}
        style={{ width: 22, height: 22, marginLeft: -4, marginRight: -4, alignItems: "center", justifyContent: "center" }}
      >
        <View
          style={{
            width: 14,
            height: 14,
            borderRadius: 7,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: visible ? calendar.color : "#00000000",
            borderWidth: 1.5,
            borderColor: calendar.color,
          }}
        >
          {visible && <Svg markup={CHECK} size={9} color="#ffffff" />}
        </View>
      </View>
      {/* The name ends in an ellipsis, 8 clear of the "⋯". */}
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center", paddingLeft: 8, marginRight: 4 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: chosen ? colors.onSelection : visible ? colors.text : colors.textMuted }}>
          {calendar.name}
        </Text>
      </View>
      <View
        testID={`calendar-menu:${calendar.id}`}
        onPress={(event) => onMenu(event.bounds?.x ?? 0, (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0))}
        style={{
          width: 22,
          height: 22,
          flexShrink: 0,
          borderRadius: 6,
          alignItems: "center",
          justifyContent: "center",
          hoverBackgroundColor: colors.separator,
        }}
      >
        {(hovered || chosen) && <Svg markup={ELLIPSIS} size={14} color={rowLook(colors, chosen).glyph} />}
      </View>
    </View>
  );
}

export function Sidebar({ calendars, hidden, target, onToggle, onChoose, onMenu, onNewCalendar, onImport, ...month }: SidebarProps) {
  const colors = useColors();
  const action = (testID: string, glyph: string, label: string, onPress: () => void) => (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        height: 28,
        flexShrink: 0,
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingHorizontal: 8,
        borderRadius: 7,
        hoverBackgroundColor: colors.button,
      }}
    >
      <Svg markup={glyph} size={14} color={colors.textMuted} />
      <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
    </View>
  );
  return (
    <>
      <ScrollView testID="sidebar-list" style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
        <MiniMonth {...month} />
        <SidebarSection title="Calendars">
          {calendars.map((calendar) => (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              visible={!hidden.includes(calendar.id)}
              chosen={calendar.id === target}
              onToggle={() => onToggle(calendar.id)}
              onChoose={() => onChoose(calendar.id)}
              onMenu={(x, y) => onMenu(calendar, x, y)}
            />
          ))}
        </SidebarSection>
      </ScrollView>
      {action("import", IMPORT, "Import…", onImport)}
      {action("new-calendar", PLUS, "New calendar…", onNewCalendar)}
    </>
  );
}

/** A glyph in the rail that names itself after a rest. */
function RailButton({ testID, glyph, name, onPress }: { testID: string; glyph: string; name: string; onPress: () => void }) {
  const colors = useColors();
  const tip = useTooltip(name);
  return (
    <View
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={() => {
        tip.hide();
        onPress();
      }}
      onHoverChange={tip.onHoverChange}
      style={{ height: 28, flexShrink: 0, borderRadius: 7, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
    >
      <Svg markup={glyph} size={14} color={colors.textMuted} />
      {tip.node}
    </View>
  );
}

/** One calendar in the rail: its dot shows or hides it, a right-click opens its menu, and it names itself after a rest. */
function RailCalendar({
  calendar,
  visible,
  onToggle,
  onMenu,
}: {
  calendar: Calendar;
  visible: boolean;
  onToggle: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const colors = useColors();
  const tip = useTooltip(calendar.name);
  return (
    <View
      testID={`calendar-check:${calendar.id}`}
      accessibilityRole="checkbox"
      accessibilityLabel={calendar.name}
      accessibilityState={{ checked: visible }}
      onPress={() => {
        tip.hide();
        onToggle();
      }}
      onContextMenu={(event) => onMenu(event.x, event.y)}
      onHoverChange={tip.onHoverChange}
      style={{ height: 28, flexShrink: 0, borderRadius: 7, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.button }}
    >
      <View
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: visible ? calendar.color : "#00000000",
          borderWidth: 1.5,
          borderColor: calendar.color,
        }}
      >
        {visible && <Svg markup={CHECK} size={9} color="#ffffff" />}
      </View>
      {tip.node}
    </View>
  );
}

export function CalendarRail({
  calendars,
  hidden,
  onToggle,
  onMenu,
  onNewCalendar,
  onImport,
}: Pick<SidebarProps, "calendars" | "hidden" | "onToggle" | "onMenu" | "onNewCalendar" | "onImport">) {
  return (
    <>
      <ScrollView testID="sidebar-list" style={{ flex: 1, minHeight: 0, flexDirection: "column", gap: 2 }}>
        {calendars.map((calendar) => (
          <RailCalendar
            key={calendar.id}
            calendar={calendar}
            visible={!hidden.includes(calendar.id)}
            onToggle={() => onToggle(calendar.id)}
            onMenu={(x, y) => onMenu(calendar, x, y)}
          />
        ))}
      </ScrollView>
      <RailButton testID="import" glyph={IMPORT} name="Import…" onPress={onImport} />
      <RailButton testID="new-calendar" glyph={PLUS} name="New calendar…" onPress={onNewCalendar} />
    </>
  );
}
