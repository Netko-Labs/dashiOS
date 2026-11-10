/**
 * Find: the field in the title's place, its answers, and picking one (the
 * view goes to its day and the event is picked).
 */

import type { Bounds } from "@mirinjs/metal";
import { useMemo, useState } from "react";
import { dayPart } from "../../../../src/shared/calendar/dates.ts";
import type { Occurrence } from "../../../../src/shared/calendar/types.ts";
import type { CalendarModel } from "../model.ts";
import { searchEvents } from "../search.ts";
import type { CalendarState } from "../state.ts";
import type { Grid } from "./use-grid.ts";

export type SearchState = { query: string; active: number };

export interface Find {
  /** Null while Find is closed. */
  search: SearchState | null;
  setSearch: (search: SearchState | null) => void;
  /** Where Find's field is, for its answers to hang from. */
  findAt: Bounds | null;
  setFindAt: (bounds: Bounds) => void;
  results: Occurrence[];
  pickResult: (occurrence: Occurrence | undefined) => void;
  /** Opens Find, keeping what was typed when it is open already. */
  open: () => void;
  close: () => void;
}

export function useFind({ model, state, grid, takeKeys }: { model: CalendarModel; state: CalendarState; grid: Grid; takeKeys: () => void }): Find {
  const { calendars, hidden, today } = state;
  const [search, setSearch] = useState<SearchState | null>(null);
  const [findAt, setFindAt] = useState<Bounds | null>(null);
  const results = useMemo(() => (search ? searchEvents(calendars, hidden, search.query, today) : []), [search?.query, calendars, hidden, today, search]);
  const pickResult = (occurrence: Occurrence | undefined): void => {
    if (!occurrence) return;
    setSearch(null);
    model.goTo(dayPart(occurrence.start));
    grid.pick(occurrence);
    takeKeys();
  };
  const close = (): void => {
    setSearch(null);
    takeKeys();
  };
  return { search, setSearch, findAt, setFindAt, results, pickResult, open: () => setSearch((now) => now ?? { query: "", active: 0 }), close };
}
