/**
 * What Files can have open over its window, one at a time: a sheet (Get
 * Info, Open With, a deletion, a name taken, Quick Look) or a menu at a
 * point. Also the counter that takes the keyboard back to the listing when
 * one closes, and the question a copy or move asks when a name is taken.
 */

import { useCallback, useEffect, useState } from "react";
import type { FileItem, OpenWithApp } from "../../../src/shared/files/index.ts";
import type { Answer, Conflict } from "./operations/conflicts.ts";
import type { Operations } from "./operations/operations.ts";

export type Sheet =
  | { kind: "info"; item: FileItem }
  | { kind: "open-with"; item: FileItem; apps: OpenWithApp[] | null }
  | { kind: "empty-trash" }
  | { kind: "delete"; items: FileItem[] }
  | { kind: "conflict"; conflict: Conflict; answer: (answer: Answer) => void }
  | { kind: "peek" };

export type MenuState = { x: number; y: number; kind: "item" | "background" | "actions" };

export interface Overlays {
  sheet: Sheet | null;
  setSheet: (sheet: Sheet | null | ((now: Sheet | null) => Sheet | null)) => void;
  menu: MenuState | null;
  setMenu: (menu: MenuState | null) => void;
  /** Changes each time the keyboard goes back to the listing. */
  focus: number;
  refocus: () => void;
  /** Closes the sheet and the menu and takes the keyboard back. */
  close: () => void;
}

export function useOverlays(ops: Operations): Overlays {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [focus, setFocus] = useState(0);
  const refocus = useCallback(() => setFocus((n) => n + 1), []);
  const close = useCallback(() => {
    setSheet(null);
    setMenu(null);
    refocus();
  }, [refocus]);

  // A copy or a move onto a taken name asks here (PA-3), one collision at a time.
  useEffect(() => {
    ops.ask = (conflict) =>
      new Promise<Answer>((resolve) =>
        setSheet({
          kind: "conflict",
          conflict,
          answer: (answer) => {
            close();
            resolve(answer);
          },
        }),
      );
    return () => {
      ops.ask = null;
    };
  }, [ops, close]);

  return { sheet, setSheet, menu, setMenu, focus, refocus, close };
}
