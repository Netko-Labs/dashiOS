/**
 * The title bar's centre: the tab strip (tab-strip.tsx) once the window has
 * two or more tabs; with one tab the bar shows the window's name alone, so
 * nothing sits there. A plain function, so the bar gets no extra element.
 */

import type { Bounds } from "@mirinjs/metal";
import type { ReactNode } from "react";
import type { Tabs } from "../tabs.ts";
import { TabStrip } from "./tab-strip.tsx";

export interface TitleCenterInput {
  tabs: Tabs;
  names: readonly string[];
  onSelect(id: number): void;
  onClose(id: number): void;
  /** The count's press: the strip's menu, under it. */
  onMore(at: Bounds): void;
}

export function titleCenter({ tabs, names, onSelect, onClose, onMore }: TitleCenterInput): ReactNode {
  if (tabs.list.length <= 1) return undefined;
  return (
    <TabStrip
      tabs={tabs.list.map((tab, index) => ({ id: tab.id, name: names[index] ?? "Terminal", rang: tab.rang }))}
      active={tabs.active}
      onSelect={onSelect}
      onClose={onClose}
      onMore={onMore}
    />
  );
}
