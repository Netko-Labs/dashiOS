/**
 * The window's own state, not the file's: which sheet is up, the "…" menu,
 * the sidebar (shown or hidden by the person's choice, or by the window's
 * width: strip.tsx), and how many jobs are working (the busy spinner, PA-5).
 */

import { type Dispatch, type SetStateAction, useState } from "react";
import type { SheetState } from "../views/overlay.tsx";
import { STRIP, stripWidth } from "../views/strip.tsx";

export interface MenuPlace {
  x: number;
  y: number;
}

export interface Chrome {
  sheet: SheetState;
  /** Opens a sheet, or closes it (null); a function of the sheet now up asks for a change only while it is that one. */
  setSheet: Dispatch<SetStateAction<SheetState>>;
  /** The "…" menu, where it hangs; null when it is closed. */
  menu: MenuPlace | null;
  setMenu(menu: MenuPlace | null): void;
  /** The page strip is showing. */
  sidebar: boolean;
  /** The strip's width: its own when the window has room, the least otherwise. */
  sidebarWidth: number;
  /** Shows the strip, or hides it, from now on by the person's choice. */
  toggleSidebar(): void;
  /** The window's width, measured. */
  setWindowWidth(width: number): void;
  /** Something is being made for the person (an export, a page to print) on (true) or done (false). */
  working(on: boolean): void;
  /** Some work is going on: the toolbar shows a spinner, once it has been a while (PA-5). */
  isWorking: boolean;
}

export function useChrome(): Chrome {
  const [sheet, setSheet] = useState<SheetState>(null);
  const [menu, setMenu] = useState<MenuPlace | null>(null);
  // The strip: shown or hidden by the person (View ▸ Sidebar), or, until they choose, by the window's width (strip.tsx).
  const [sidebarChoice, setSidebarChoice] = useState<boolean | null>(null);
  const [windowWidth, setWindowWidth] = useState<number | null>(null);
  const [jobs, setJobs] = useState(0);
  const autoWidth = stripWidth(windowWidth);
  const sidebar = sidebarChoice ?? autoWidth > 0;
  return {
    sheet,
    setSheet,
    menu,
    setMenu,
    sidebar,
    sidebarWidth: autoWidth > 0 ? autoWidth : STRIP.least,
    toggleSidebar: () => setSidebarChoice(!sidebar),
    setWindowWidth,
    working: (on) => setJobs((now) => Math.max(0, now + (on ? 1 : -1))),
    isWorking: jobs > 0,
  };
}
