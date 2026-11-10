/**
 * What the window draws from the model: its snapshot, the occurrences and
 * days in view, a calendar's color, where a new event goes, and the clock
 * that moves the now line.
 */

import { useColors, useUndo } from "@dashi/ui";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Occurrence } from "../../../../src/shared/calendar/index.ts";
import { viewDays } from "../layout.ts";
import type { CalendarModel } from "../model.ts";
import type { CalendarState } from "../state.ts";
import { newEventTarget, type Target } from "../target.ts";

export interface CalendarData {
  state: CalendarState;
  occurrences: readonly Occurrence[];
  days: ReturnType<typeof viewDays>;
  colorOf: (calendarId: string) => string;
  /** Where a new event goes: the calendar chosen in the sidebar (or used last), never a hidden one (target.ts). */
  destination: Target | null;
  choose: (calendarId: string | null) => void;
  undo: ReturnType<typeof useUndo>;
}

export function useCalendarData(model: CalendarModel, firstDay: number): CalendarData {
  const colors = useColors();
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot);
  const { view, anchor, calendars, hidden } = state;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the model is mutable; these say when its occurrences changed
  const occurrences = useMemo(() => model.occurrences(firstDay), [model, state.calendars, state.hidden, state.view, state.anchor, firstDay]);
  const days = useMemo(() => viewDays(view, anchor, firstDay), [view, anchor, firstDay]);
  const colorOf = (id: string): string => calendars.find((calendar) => calendar.id === id)?.color ?? colors.selection;
  const [chosen, choose] = useState<string | null>(null);
  const destination = newEventTarget(calendars, hidden, chosen);
  const undo = useUndo(model.undo);
  return { state, occurrences, days, colorOf, destination, choose, undo };
}

/** The time now, moved every 30 s (which is also when the model checks its alerts). */
export function useNow(model: CalendarModel): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(new Date());
      model.tick();
    }, 30_000);
    return () => clearInterval(tick);
  }, [model]);
  return now;
}
