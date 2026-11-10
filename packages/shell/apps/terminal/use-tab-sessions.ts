/**
 * The window's tabs and their shells, held together: the tab list in state
 * (tabs.ts), the sessions that run in each tab (sessions.ts), and the bell's
 * count, which lights the grid's edge when the tab in front rings. The shells
 * read the tabs and the palette through refs, so they always see the latest.
 */

import { useRef, useState } from "react";
import type { Clipboard } from "../kit/index.ts";
import type { TerminalPalette } from "./palette.ts";
import { type Sessions, useSessions } from "./sessions.ts";
import { NO_TABS, type Tabs } from "./tabs.ts";

export interface TabSessions {
  tabs: Tabs;
  setTabs(change: (tabs: Tabs) => Tabs): void;
  sessions: Sessions;
  /** Counts up each bell in the tab in front: the grid's edge flashes on a change. */
  bells: number;
}

export interface TabSessionsInput {
  binary: string;
  clipboard: Clipboard;
  palette: TerminalPalette;
}

export function useTabSessions({ binary, clipboard, palette }: TabSessionsInput): TabSessions {
  const [tabs, setTabsState] = useState<Tabs>(NO_TABS);
  const [bells, setBells] = useState(0);
  const tabsNow = useRef(tabs);
  tabsNow.current = tabs;
  const setTabs = (change: (tabs: Tabs) => Tabs): void => setTabsState(change);
  const paletteNow = useRef(palette);
  paletteNow.current = palette;
  const sessions = useSessions({
    binary,
    clipboard,
    palette: () => paletteNow.current,
    setTabs,
    tabs: () => tabsNow.current,
    onFrontBell: () => setBells((n) => n + 1),
  });
  return { tabs, setTabs, sessions, bells };
}
