/**
 * A tile's page by the keyboard (panel.tsx): the rows the arrows reach, and
 * the ring that says which one they are on (lib/page-keys.ts has the order).
 * A page's rows are built from page-parts.tsx; a row drawn elsewhere (the
 * Sound page's apps, sound/app-rows.tsx) joins the same keys with
 * `usePageKey`.
 */

import type { Bounds } from "@mirinjs/metal";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { pageOrder, stepRow } from "./lib/page-keys.ts";

/** A row that can be pressed, as the page's keys know it (panel.tsx, page-keys.ts). */
export interface PageKeyRow {
  press: () => void;
  /** ← or → on the row: a slider's step down or up; none for a row that is only pressed. */
  step?: (direction: "left" | "right") => void;
  y: number | null;
}

/** The page's keys: which row the ring is on, and the rows that can be pressed, by id. */
export interface PageKeys {
  focused: string | null;
  rows: Map<string, PageKeyRow>;
}

/** The panel's page keys; none outside a panel (a page drawn on its own). */
export const PageKeysContext = createContext<PageKeys | null>(null);

/**
 * The keys of the page that is open (panel.tsx): what its rows read from
 * `PageKeysContext`, and `pageKey` for a key the panel didn't take: ← →
 * step the row the ring is on when it is a slider (an app's volume), ↑ ↓
 * move between the rows top to bottom, Space and Return press the one the
 * ring is on. Another page, or the tiles again, starts from no row.
 */
export function usePageKeys(page: string): { pageKeys: PageKeys; pageKey: (name: string) => void } {
  const rows = useRef(new Map<string, PageKeyRow>());
  const [focused, setFocused] = useState<string | null>(null);
  const pageKeys = useMemo(() => ({ focused, rows: rows.current }), [focused]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on each page change.
  useEffect(() => setFocused(null), [page]);
  const pageKey = (name: string): void => {
    if (name === "up" || name === "down") {
      const order = pageOrder([...rows.current].map(([id, row]) => ({ id, y: row.y })));
      setFocused((now) => stepRow(order, now, name));
      return;
    }
    if ((name === "left" || name === "right") && focused !== null) rows.current.get(focused)?.step?.(name);
    if ((name === "space" || name === "enter") && focused !== null) rows.current.get(focused)?.press();
  };
  return { pageKeys, pageKey };
}

/**
 * A row the page's arrows reach: whether the ring is on it, and its
 * `onLayout`, which tells the keys where it is drawn. A row that can't be
 * pressed now (the output in use, the network joining) still takes the
 * ring, so choosing a row leaves the ring on it. A row with `step` is a
 * slider too: ← and → move it.
 */
export function usePageKey(
  id: string,
  press: (() => void) | undefined,
  step?: (direction: "left" | "right") => void,
): { focused: boolean; onLayout: (bounds: Bounds) => void } {
  const keys = useContext(PageKeysContext);
  const latest = useRef({ press, step });
  latest.current = { press, step };
  const y = useRef<number | null>(null);
  useEffect(() => {
    if (!keys) return;
    keys.rows.set(id, { press: () => latest.current.press?.(), step: (direction) => latest.current.step?.(direction), y: y.current });
    return () => {
      keys.rows.delete(id);
    };
  }, [keys, id]);
  return {
    focused: keys?.focused === id,
    onLayout: (bounds) => {
      y.current = bounds.y;
      const row = keys?.rows.get(id);
      if (row) row.y = bounds.y;
    },
  };
}
