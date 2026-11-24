/**
 * The sidebar: the mini month, the calendars, and Import and New calendar.
 * Each calendar is a sidebar row (`SidebarItem`) on a tile of its colour:
 * pressing it picks it as the one new events go to (it is lit), and ↑ ↓ move
 * between them, one Tab stop for the list (KB-1). Its check box shows or
 * hides it, and the lit row's More opens its menu (as a right-click on any
 * row does). The month and the calendars scroll in a short window; Import
 * and New calendar stay at its foot. In a narrow window it is the rail
 * (LA-5): the tiles alone, each named by a tooltip, and the two actions as
 * glyphs.
 */

import { Checkbox, MORE, SidebarItem, SidebarSection, SPACE, ToolbarButton } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import type { Calendar } from "../../../../src/shared/calendar/index.ts";
import { CALENDAR, IMPORT, PLUS } from "../glyphs.ts";
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
  /** The rail: the calendars' tiles alone (LA-5). */
  rail?: boolean;
}

/**
 * The kit's check box that shows or hides a calendar, its box only: the row
 * says the name, so the words ("Show Work", what a screen reader reads) are
 * kept out of sight.
 */
function ShownBox({ calendar, visible, onToggle }: { calendar: Calendar; visible: boolean; onToggle: () => void }) {
  // The row names the calendar: the box alone, its words for screen readers.
  return <Checkbox testID={`calendar-check:${calendar.id}`} label={`Show ${calendar.name}`} checked={visible} onChange={onToggle} hideLabel />;
}

function CalendarRow({
  calendar,
  visible,
  chosen,
  rail,
  onToggle,
  onChoose,
  onMenu,
}: {
  calendar: Calendar;
  visible: boolean;
  chosen: boolean;
  rail: boolean;
  onToggle: () => void;
  onChoose: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  return (
    <View testID={`calendar-row:${calendar.id}`} onContextMenu={(event) => onMenu(event.x, event.y)} style={{ flexDirection: "column", flexShrink: 0 }}>
      <SidebarItem
        testID={`calendar:${calendar.id}`}
        label={calendar.name}
        selected={chosen}
        rail={rail}
        tile={{ glyph: CALENDAR, tint: calendar.color }}
        {...(rail && !visible ? { badge: "Hidden" } : {})}
        onPress={onChoose}
        accessory={
          <View style={{ flexDirection: "row", alignItems: "center", gap: SPACE.xs }}>
            {chosen && (
              <ToolbarButton
                testID={`calendar-menu:${calendar.id}`}
                glyph={MORE}
                tooltip={`${calendar.name} options`}
                onPress={(event) => onMenu(event.bounds?.x ?? 0, (event.bounds?.y ?? 0) + (event.bounds?.height ?? 0))}
              />
            )}
            <ShownBox calendar={calendar} visible={visible} onToggle={onToggle} />
          </View>
        }
      />
    </View>
  );
}

/** Import and New calendar, at the sidebar's foot: worded in the full sidebar, glyphs named by tooltips in the rail. */
function SidebarActions({ rail, onImport, onNewCalendar }: { rail: boolean; onImport: () => void; onNewCalendar: () => void }) {
  const words = (label: string) => (rail ? { tooltip: label } : { label });
  return (
    <View style={{ flexShrink: 0, flexDirection: "column", alignItems: rail ? "center" : "flex-start", gap: SPACE.xxs }}>
      <ToolbarButton testID="import" glyph={IMPORT} {...words("Import…")} onPress={onImport} />
      <ToolbarButton testID="new-calendar" glyph={PLUS} {...words("New calendar…")} onPress={onNewCalendar} />
    </View>
  );
}

export function Sidebar({ calendars, hidden, target, onToggle, onChoose, onMenu, onNewCalendar, onImport, rail = false, ...month }: SidebarProps) {
  return (
    <>
      <ScrollView testID="sidebar-list" style={{ flex: 1, minHeight: 0, flexDirection: "column" }}>
        {!rail && <MiniMonth {...month} />}
        <SidebarSection {...(rail ? {} : { title: "Calendars" })}>
          {calendars.map((calendar) => (
            <CalendarRow
              key={calendar.id}
              calendar={calendar}
              visible={!hidden.includes(calendar.id)}
              chosen={calendar.id === target}
              rail={rail}
              onToggle={() => onToggle(calendar.id)}
              onChoose={() => onChoose(calendar.id)}
              onMenu={(x, y) => onMenu(calendar, x, y)}
            />
          ))}
        </SidebarSection>
      </ScrollView>
      <SidebarActions rail={rail} onImport={onImport} onNewCalendar={onNewCalendar} />
    </>
  );
}
