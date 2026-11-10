/**
 * The Activity Monitor's window state, composed from its hooks: the tab, the
 * search, the view's choices and the window's size (here), who has the
 * keyboard (use-keyboard-owner.ts), the list and its selection
 * (use-listing.ts), the sheets and menus (use-sheets.ts), and the keys and the
 * menu bar (use-keys.ts). The monitor's own settings (kernel, interval, tab)
 * follow the view here, and a second start's request (`onOpen`) lands here.
 * The result is the model the components draw (view.tsx, toolbar.tsx,
 * content.tsx, overlay.tsx).
 */

import { useTitleBarInset } from "@dashi/ui";
import { type Dispatch, type SetStateAction, useEffect, useState, useSyncExternalStore } from "react";
import type { MonitorActions } from "./actions.ts";
import type { OpenRequest } from "./args.ts";
import type { ViewChoices } from "./menus.ts";
import type { Monitor, MonitorState, Tab } from "./monitor.ts";
import type { WindowSize } from "./sized.tsx";
import { MONITOR_SIZE } from "./sizes.ts";
import { type ToolbarFit, toolbarFit, toolbarRoom } from "./toolbar-fit.ts";
import { type KeyboardHand, useKeyboardOwner } from "./use-keyboard-owner.ts";
import { type MonitorKeys, useMonitorKeys } from "./use-keys.ts";
import { type Listing, useListing } from "./use-listing.ts";
import { type Sheets, useSheets } from "./use-sheets.ts";

export interface MonitorModel {
  actions: MonitorActions;
  state: MonitorState;
  tab: Tab;
  chooseTab(next: Tab): void;
  view: ViewChoices;
  setView: Dispatch<SetStateAction<ViewChoices>>;
  query: string;
  setQuery: Dispatch<SetStateAction<string>>;
  size: WindowSize;
  onSize(next: WindowSize): void;
  /** The title bar's height: the inspect sheet's room under the window controls. */
  insetTop: number;
  fit: ToolbarFit;
  keyboard: KeyboardHand;
  listing: Listing;
  sheets: Sheets;
  keys: MonitorKeys;
}

export function useMonitorWindow(monitor: Monitor, actions: MonitorActions, initial: OpenRequest): MonitorModel {
  const state = useSyncExternalStore(monitor.subscribe, monitor.getSnapshot);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "cpu");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewChoices>({ grouped: true, mine: false, kernel: false, summary: true, interval: 2000 });
  // The toolbar, the columns and the summary fit the window's size (sized.tsx).
  const [size, setSize] = useState<WindowSize>(MONITOR_SIZE);
  const inset = useTitleBarInset();
  const fit = toolbarFit(toolbarRoom(size.width, inset.leading));

  const keyboard = useKeyboardOwner();
  const listing = useListing({ rows: state.rows, tab, query, view, initialApp: initial.app ?? null, takeKeyboard: keyboard.toList });
  const sheets = useSheets({ monitor, actions, rows: state.rows, selectedLine: listing.selectedLine, giveBack: keyboard.giveBack });
  const keys = useMonitorKeys({
    tab,
    view,
    setView,
    chooseTab: setTab,
    listing,
    sheets,
    actions,
    toField: keyboard.toField,
    toList: keyboard.toList,
  });

  useEffect(() => monitor.setKernel(view.kernel), [monitor, view.kernel]);
  useEffect(() => monitor.setInterval(view.interval), [monitor, view.interval]);
  useEffect(() => {
    monitor.setTab(tab);
  }, [monitor, tab]);
  useEffect(
    () =>
      actions.onOpen((request) => {
        if (request.tab) setTab(request.tab);
        if (request.app) {
          setQuery("");
          setView((current) => ({ ...current, grouped: true }));
          listing.setWanted(request.app);
        }
      }),
    [actions, listing.setWanted],
  );

  return {
    actions,
    state,
    tab,
    chooseTab: setTab,
    view,
    setView,
    query,
    setQuery,
    size,
    onSize: (next) => setSize((now) => (now.width === next.width && now.height === next.height ? now : next)),
    insetTop: inset.top,
    fit,
    keyboard,
    listing,
    sheets,
    keys,
  };
}
