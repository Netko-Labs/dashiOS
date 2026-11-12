/**
 * The calendar's content: the month or the time grid, the key sink that
 * brings the window's keys to the grid, and the wash over it while an .ics
 * file is dragged over the window.
 */

import { useColors } from "@dashi/ui";
import { type Bounds, type DropInfo, View } from "@mirinjs/metal";
import { useState } from "react";
import type { Day, Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { ClockPrefs } from "../../../../src/shared/time/index.ts";
import { TimeGrid } from "../grid/time-grid.tsx";
import type { Grid } from "../hooks/use-grid.ts";
import { isIcsPath } from "../import.ts";
import type { CalendarState } from "../state.ts";
import { MonthView } from "./month-view.tsx";

/** An .ics file dragged over the window: whether one is over it now, and its import when it is let go. */
function useIcsDrop(importPath: (path: string) => void): { dropping: boolean; onDrop: (drop: DropInfo) => void } {
  const [dropping, setDropping] = useState(false);
  const onDrop = (drop: DropInfo): void => {
    if (drop.phase === "enter" || drop.phase === "over") setDropping(drop.paths.some(isIcsPath));
    else setDropping(false);
    const file = drop.phase === "drop" ? drop.paths.find(isIcsPath) : undefined;
    if (file) importPath(file);
  };
  return { dropping, onDrop };
}

export function CalendarContent({
  state,
  firstDay,
  prefs,
  days,
  now,
  occurrences,
  colorOf,
  grid,
  keys,
  keysOpen,
  onLayout,
  importPath,
  scroll,
}: {
  state: CalendarState;
  firstDay: number;
  prefs: ClockPrefs;
  days: readonly Day[];
  now: Date;
  occurrences: readonly Occurrence[];
  colorOf: (calendarId: string) => string;
  grid: Grid;
  /** Changes when the keyboard goes back to the window. */
  keys: number;
  /** Nothing else wants the keys: no sheet, popover, Find or menu. */
  keysOpen: boolean;
  onLayout: (bounds: Bounds) => void;
  importPath: (path: string) => void;
  scroll: (testID: string, dy: number) => void;
}) {
  const colors = useColors();
  const { dropping, onDrop } = useIcsDrop(importPath);
  const { view, anchor, today } = state;
  return (
    <View testID="calendar-content" style={{ flex: 1, flexDirection: "column", minHeight: 0, position: "relative" }} onLayout={onLayout} onDrop={onDrop}>
      {keysOpen && (
        <View key={String(keys)} testID="keys" onWindowKeyDown={grid.onKey} style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0 }} />
      )}
      {view === "month" ? (
        <MonthView
          anchor={anchor}
          today={today}
          firstDay={firstDay}
          prefs={prefs}
          occurrences={occurrences}
          colorOf={colorOf}
          state={grid.state}
          handlers={grid.handlers}
        />
      ) : (
        <TimeGrid
          days={days}
          today={today}
          now={now}
          prefs={prefs}
          occurrences={occurrences}
          colorOf={colorOf}
          state={grid.state}
          handlers={grid.handlers}
          scroll={scroll}
        />
      )}
      {dropping && (
        <View
          testID="drop-target"
          style={{ position: "absolute", left: 4, top: 4, right: 4, bottom: 4, borderRadius: 8, borderWidth: 2, borderColor: colors.selection }}
        />
      )}
    </View>
  );
}
