/**
 * What the notes window can have open over its list, one at a time: a
 * sheet (a folder's name, a deletion) or a menu at a point. Also the counter
 * that takes the keyboard back to the list when one closes.
 */

import type { MenuItem } from "@dashi/ui";
import { useState } from "react";
import type { SheetState } from "../views/sheets.tsx";

/** A menu at a point; "end" hangs it by its right edge (the toolbar's Move, under its button). */
export type Menu = { x: number; y: number; items: MenuItem[]; anchor?: "start" | "end" };

export interface Overlays {
  sheet: SheetState | null;
  setSheet: (sheet: SheetState | null) => void;
  menu: Menu | null;
  setMenu: (menu: Menu | null) => void;
  /** Changes each time the keyboard goes back to the list (the key sink is focused again). */
  keys: number;
  takeKeys: () => void;
  closeOverlay: () => void;
}

export function useOverlays(): Overlays {
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [keys, setKeys] = useState(0);
  const takeKeys = (): void => setKeys((n) => n + 1);
  const closeOverlay = (): void => {
    setSheet(null);
    setMenu(null);
    takeKeys();
  };
  return { sheet, setSheet, menu, setMenu, keys, takeKeys, closeOverlay };
}
