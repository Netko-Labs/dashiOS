/**
 * What the calendar window can have open over its grid, one at a time: a
 * sheet (a question, a calendar's settings, an import), the full event
 * sheet, or a calendar's menu. Also the key sink's remount counter that
 * takes the keyboard back to the window when one closes.
 */

import type { MenuItem } from "@dashi/ui";
import { useState } from "react";
import type { Occurrence } from "../../../../src/shared/calendar/index.ts";
import type { Draft } from "../draft.ts";
import type { SheetState } from "../sheets/sheets.tsx";

export type Menu = { x: number; y: number; items: MenuItem[] };
/** The full sheet: its draft as opened, and the time of the event it edits (null for a new one). */
export type Editing = { draft: Draft; occurrence: Occurrence | null };

export interface Overlays {
  sheet: SheetState | null;
  setSheet: (sheet: SheetState | null) => void;
  editing: Editing | null;
  setEditing: (editing: Editing | null) => void;
  menu: Menu | null;
  setMenu: (menu: Menu | null) => void;
  /** Changes each time the keyboard goes back to the window (the key sink is made again). */
  keys: number;
  takeKeys: () => void;
  closeOverlay: () => void;
  /** A sheet or the full sheet is open: the menus' event commands wait. */
  modal: boolean;
}

export function useOverlays(): Overlays {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [keys, setKeys] = useState(0);
  const takeKeys = (): void => setKeys((n) => n + 1);
  const closeOverlay = (): void => {
    setSheet(null);
    setEditing(null);
    setMenu(null);
    takeKeys();
  };
  return { sheet, setSheet, editing, setEditing, menu, setMenu, keys, takeKeys, closeOverlay, modal: sheet !== null || editing !== null };
}
