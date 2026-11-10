/**
 * The menu bar's stops for the keyboard (menus/bar-keys.ts): the titles'
 * here, the status side's passed in by it, registered with the menus after
 * each draw and dropped when the bar goes.
 */

import type { Bounds } from "@mirinjs/metal";
import { useEffect, useRef } from "react";
import { type BarMenuId, type BarStop, type MenuController, titleStop } from "./menus/index.ts";

/** A title's words, for a screen reader and the keyboard's ring. */
export function titleLabel(id: BarMenuId, appName: string, titles: readonly { id: BarMenuId; title: string }[]): string {
  return id === "dashi" ? "Dashi" : id === "app" ? appName : (titles.find((title) => title.id === id)?.title ?? id);
}

/** Where the titles are drawn, and the status side's stops (its `onStops` fills them). */
export function useBarStops(
  menus: MenuController,
  output: string | undefined,
  appName: string,
  titles: readonly { id: BarMenuId; title: string }[],
): { titleBounds: { current: Map<BarMenuId, Bounds> }; statusStops: { current: BarStop[] } } {
  const titleBounds = useRef(new Map<BarMenuId, Bounds>());
  const statusStops = useRef<BarStop[]>([]);
  // The bar's stops for the keyboard, after each draw: its titles, then the status side's (StatusSide's `onStops` comes first).
  useEffect(() => {
    const menuIds: BarMenuId[] = ["dashi", "app", ...titles.map((title) => title.id)];
    const titleStops = menuIds.map(
      (id): BarStop => ({
        key: titleStop(id),
        label: titleLabel(id, appName, titles),
        kind: "menu",
        open: () => void menus.toggleMenu(id, titleBounds.current.get(id)?.x ?? 0, appName, output),
      }),
    );
    menus.setBar(output, { appName, stops: [...titleStops, ...statusStops.current] });
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when this bar goes.
  useEffect(() => () => menus.dropBar(output), []);
  return { titleBounds, statusStops };
}
