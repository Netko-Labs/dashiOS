/**
 * The sidebar: the mini month, the calendars with their colors and
 * checkboxes, and New Calendar and Import. The checkbox shows or hides a
 * calendar; pressing the row picks it as the one new events go to (it is
 * lit), so hiding one takes aiming.
 */

import { rowLook, SelectionBar, SidebarSection, useColors } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { CHECK, ELLIPSIS, IMPORT, PLUS } from "./glyphs.ts";
import { MiniMonth, type MiniMonthProps } from "./mini-month.tsx";
import type { Calendar } from "./types.ts";

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
  return (
    // The whole row picks the calendar; the check and the menu inside it take their own presses
    // (Metal gives a press to the innermost view that handles it).
    <View
      testID={`calendar-row:${calendar.id}`}
      onPress={onChoose}
      onContextMenu={(event) => onMenu(event.x, event.y)}
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
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center", paddingLeft: 8 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: chosen ? colors.onSelection : visible ? colors.text : colors.textMuted }}>
          {calendar.name}
        </Text>
      </View>
      <View
        testID={`calendar-menu:${calendar.id}`}
        onPress={(event) => onMenu(event.bounds?.x ?? 0, (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0))}
        style={{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.separator }}
      >
        <Svg markup={ELLIPSIS} size={14} color={rowLook(colors, chosen).glyph} />
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
      <View style={{ flex: 1 }} />
      {action("import", IMPORT, "Import…", onImport)}
      {action("new-calendar", PLUS, "New Calendar", onNewCalendar)}
    </>
  );
}
