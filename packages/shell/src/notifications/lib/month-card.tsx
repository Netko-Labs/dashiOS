/**
 * The calendar at the top of the notification center: the kit's one month
 * grid (UI-14), this month, today an ink disc and a day with events an ink
 * dot (NO-3, CO-2: nothing here is chosen, so no accent), the week starting
 * on the person's first day (Language & Region). ‹ › page through months; a
 * day opens in Calendar, once Calendar is there to show it.
 */

import { addMonths, type Day, dayKey, MonthGrid, RADIUS, SPACE, useColors } from "@dashi/ui";
import { View } from "@mirinjs/metal";
import { useState } from "react";
import { calendarBridge, useBusyDays } from "../../calendar/bridge.ts";
import { addDays, firstOfMonth, startOfWeek } from "../../shared/calendar/index.ts";
import { firstDayIndex, useClockPrefs } from "../../shared/time/index.ts";

/** Six weeks, the most a month's grid shows. */
const SHOWN_DAYS = 42;

export function MonthCard({ now, onOpenDay }: { now: Date; onOpenDay?: (day: string) => void }) {
  const colors = useColors();
  const prefs = useClockPrefs();
  const today: Day = { year: now.getFullYear(), month: now.getMonth(), date: now.getDate() };
  const [view, setView] = useState({ year: today.year, month: today.month });
  const firstDay = firstDayIndex(prefs.locale, prefs.firstWeekday);
  const start = startOfWeek(firstOfMonth(view.year, view.month), firstDay);
  const busy = useBusyDays(start, addDays(start, SHOWN_DAYS));
  const clickable = onOpenDay !== undefined && calendarBridge() !== null;
  return (
    <View
      testID="nc-month-card"
      style={{ alignItems: "center", padding: SPACE.inset, borderRadius: RADIUS.card, backgroundColor: colors.tile, flexShrink: 0 }}
    >
      <MonthGrid
        testID="nc-month"
        year={view.year}
        month={view.month}
        today={today}
        firstWeekday={firstDay}
        locale={prefs.locale}
        marked={busy}
        onMonth={(by) => setView((shown) => addMonths(shown.year, shown.month, by))}
        {...(clickable ? { onChoose: (day: Day) => onOpenDay?.(dayKey(day)) } : {})}
      />
    </View>
  );
}
