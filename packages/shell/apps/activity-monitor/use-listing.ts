/**
 * The Activity Monitor's list: the rows the tab, the search and the view make
 * (lines.ts), their columns and sort (columns.ts), which apps are open, and
 * the selected line. The selection is a line's key, not a place in the list,
 * so the rows can re-sort every two seconds without moving it. The battery
 * menu's app is selected once its line is there (`setWanted`).
 */

import type { Column, SortState } from "@dashi/ui";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react";
import type { OpenRequest } from "./args.ts";
import { COLUMNS, DEFAULT_SORT } from "./columns.ts";
import { buildLines, type Line, lineForApp } from "./lines.ts";
import type { ViewChoices } from "./menus.ts";
import type { MonitorState, Tab } from "./monitor.ts";
import { namedColumn } from "./name-cell.tsx";
import { filterRows, scopeTotals } from "./sample.ts";

/** An app a second start (or a battery menu) asked to see: its line is selected once listed. */
export type WantedApp = NonNullable<OpenRequest["app"]>;

export interface Listing {
  sort: SortState;
  sortBy(next: SortState): void;
  columns: Column<Line>[];
  lines: Line[];
  keys: string[];
  selectedLine: Line | null;
  setSelected: Dispatch<SetStateAction<string | null>>;
  totals: ReturnType<typeof scopeTotals>;
  toggle(appKey: string): void;
  setWanted: Dispatch<SetStateAction<WantedApp | null>>;
}

export interface ListingInput {
  rows: MonitorState["rows"];
  tab: Tab;
  query: string;
  view: ViewChoices;
  /** The app the window was opened for (a battery menu's), selected once listed. */
  initialApp: WantedApp | null;
  /** Gives the list the keyboard when a name's disclosure is pressed. */
  takeKeyboard(): void;
}

export function useListing(input: ListingInput): Listing {
  const { rows, tab, query, view, initialApp, takeKeyboard } = input;
  const [sorts, setSorts] = useState(DEFAULT_SORT);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [wanted, setWanted] = useState(initialApp);

  const sort = sorts[tab];
  const sortBy = (next: SortState): void => setSorts({ ...sorts, [tab]: next });
  const toggle = useCallback((appKey: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(appKey)) next.add(appKey);
      return next;
    });
  }, []);
  const columns = useMemo(
    () =>
      COLUMNS[tab].map((column) =>
        column.key === "name"
          ? namedColumn(column, (each) => {
              toggle(each.key.slice(4));
              takeKeyboard();
            })
          : column,
      ),
    [tab, toggle, takeKeyboard],
  );
  const lines = useMemo(
    () => buildLines(filterRows(rows, query, view), { grouped: view.grouped, expanded, query, columns, sort }),
    [rows, query, view, expanded, columns, sort],
  );
  const selectedLine = lines.find((line) => line.key === selected) ?? null;
  const totals = useMemo(() => scopeTotals(rows, view), [rows, view]);
  const keys = lines.map((line) => line.key);

  // The battery menu's app, selected once its line is there.
  useEffect(() => {
    if (!wanted) return;
    const found = lineForApp(lines, wanted);
    if (found) {
      setSelected(found);
      setWanted(null);
    }
  }, [lines, wanted]);

  return { sort, sortBy, columns, lines, keys, selectedLine, setSelected, totals, toggle, setWanted };
}
