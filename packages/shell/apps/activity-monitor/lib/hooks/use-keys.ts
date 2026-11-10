/**
 * The Activity Monitor's keys and menu bar: a press (a second press within
 * a double-click's time inspects), the arrows that move the selection, → and ←
 * that open and close an app, Copy, and the menu bar's menus (menus.ts, run
 * through the kit). The list has the keyboard until the person clicks the
 * search field or presses ❖F; this hook is what the list's keys and the menus
 * call.
 */

import { moveSelection } from "@dashi/ui";
import { useRef } from "react";
import { useAppMenus } from "../../../kit/index.ts";
import type { MonitorActions } from "../actions.ts";
import type { Line } from "../lines.ts";
import { parentKey } from "../lines.ts";
import { monitorMenus, type ViewChoices } from "../menus.ts";
import type { Tab } from "../monitor.ts";
import type { Listing } from "./use-listing.ts";
import type { Sheets } from "./use-sheets.ts";

const DOUBLE_CLICK_MS = 450;

export interface MonitorKeys {
  press(key: string): void;
  move(direction: "up" | "down"): void;
  /** → opens the selected app, ← closes it; ← on one of its processes goes up to the app. */
  expandWith(key: "left" | "right"): void;
  copy(line?: Line | null): void;
  /** A right click: the line is selected and the context menu opens at the point. */
  contextAt(key: string, point: { x: number; y: number }): void;
}

export interface KeysInput {
  tab: Tab;
  view: ViewChoices;
  setView(next: ViewChoices): void;
  chooseTab(next: Tab): void;
  listing: Listing;
  sheets: Sheets;
  actions: MonitorActions;
  toField(): void;
  toList(): void;
}

export function useMonitorKeys(input: KeysInput): MonitorKeys {
  const { tab, view, setView, chooseTab, listing, sheets, actions, toField, toList } = input;
  const { selectedLine, lines, keys, columns, setSelected, toggle } = listing;
  const lastPress = useRef<{ key: string; at: number } | null>(null);

  const copy = (line: Line | null = selectedLine): void => {
    if (line) actions.copy(columns.map((column) => column.text(line)).join("\t"));
  };
  const press = (key: string): void => {
    const now = Date.now();
    const again = lastPress.current?.key === key && now - lastPress.current.at <= DOUBLE_CLICK_MS;
    lastPress.current = again ? null : { key, at: now };
    setSelected(key);
    toList();
    if (again) sheets.inspect(lines.find((line) => line.key === key) ?? null);
  };
  const move = (direction: "up" | "down"): void => setSelected(moveSelection(keys, selectedLine?.key ?? null, direction));
  const expandWith = (key: "left" | "right"): void => {
    if (!selectedLine) return;
    if (selectedLine.expandable) {
      if (selectedLine.expanded !== (key === "right")) toggle(selectedLine.key.slice(4));
      return;
    }
    if (key === "left" && selectedLine.depth > 0) setSelected(parentKey(lines, selectedLine.key));
  };
  const contextAt = (key: string, point: { x: number; y: number }): void => {
    setSelected(key);
    sheets.setMenu({ kind: "context", x: point.x, y: point.y });
  };

  // The menu bar's menus (src/app-menus/).
  const { menus, run } = monitorMenus({
    tab,
    view,
    hasSelection: selectedLine !== null,
    blocked: sheets.blocked,
    actions: {
      find: toField,
      copy: () => copy(),
      setView: (patch) => setView({ ...view, ...patch }),
      chooseTab,
      inspect: () => sheets.inspect(),
      quitProcess: () => sheets.quit(),
    },
  });
  useAppMenus(menus, run);

  return { press, move, expandWith, copy, contextAt };
}
