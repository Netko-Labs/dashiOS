/** The sidebar: the mini month, the calendars with their colors and checkboxes, and New Calendar and Import. */

import { Svg, Text, View } from "@mirinjs/metal";
import { SidebarSection, useColors } from "../kit/index.ts";
import { CHECK, ELLIPSIS, IMPORT, PLUS } from "./glyphs.ts";
import { MiniMonth, type MiniMonthProps } from "./mini-month.tsx";
import type { Calendar } from "./types.ts";

export interface SidebarProps extends MiniMonthProps {
  calendars: readonly Calendar[];
  hidden: readonly string[];
  onToggle: (id: string) => void;
  onMenu: (calendar: Calendar, x: number, y: number) => void;
  onNewCalendar: () => void;
  onImport: () => void;
}

function CalendarRow({ calendar, visible, onToggle, onMenu }: { calendar: Calendar; visible: boolean; onToggle: () => void; onMenu: (x: number, y: number) => void }) {
  const colors = useColors();
  return (
    <View
      testID={`calendar-row:${calendar.id}`}
      onPress={onToggle}
      onContextMenu={(event) => onMenu(event.x, event.y)}
      style={{ height: 28, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, borderRadius: 7, hoverBackgroundColor: colors.button }}
    >
      <View
        testID={`calendar-check:${calendar.id}`}
        style={{ width: 14, height: 14, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: visible ? calendar.color : "#00000000", borderWidth: 1.5, borderColor: calendar.color }}
      >
        {visible && <Svg markup={CHECK} size={9} color="#ffffff" />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, color: visible ? colors.text : colors.textMuted }}>
          {calendar.name}
        </Text>
      </View>
      <View
        testID={`calendar-menu:${calendar.id}`}
        onPress={(event) => onMenu(event.bounds?.x ?? 0, (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0))}
        style={{ width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", hoverBackgroundColor: colors.separator }}
      >
        <Svg markup={ELLIPSIS} size={14} color={colors.textMuted} />
      </View>
    </View>
  );
}

export function Sidebar({ calendars, hidden, onToggle, onMenu, onNewCalendar, onImport, ...month }: SidebarProps) {
  const colors = useColors();
  const action = (testID: string, glyph: string, label: string, onPress: () => void) => (
    <View testID={testID} onPress={onPress} style={{ height: 28, flexShrink: 0, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 8, borderRadius: 7, hoverBackgroundColor: colors.button }}>
      <Svg markup={glyph} size={14} color={colors.textMuted} />
      <Text style={{ fontSize: 13, color: colors.textMuted }}>{label}</Text>
    </View>
  );
  return (
    <>
      <MiniMonth {...month} />
      <SidebarSection title="Calendars">
        {calendars.map((calendar) => (
          <CalendarRow key={calendar.id} calendar={calendar} visible={!hidden.includes(calendar.id)} onToggle={() => onToggle(calendar.id)} onMenu={(x, y) => onMenu(calendar, x, y)} />
        ))}
      </SidebarSection>
      <View style={{ flex: 1 }} />
      {action("import", IMPORT, "Import…", onImport)}
      {action("new-calendar", PLUS, "New Calendar", onNewCalendar)}
    </>
  );
}
