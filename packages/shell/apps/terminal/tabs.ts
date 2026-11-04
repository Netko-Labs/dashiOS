/**
 * A Terminal window's tabs: one dashi-term each, in the order the tab bar
 * shows them, one of them in front. Pure: the view keeps a `Tabs` in state
 * and the engines beside it, keyed by the tab's id.
 */

import { EMPTY_SCREEN, type Screen } from "./screen.ts";

export interface Tab {
  id: number;
  /** What the program last set (OSC 0/2), else "Terminal". */
  title: string;
  screen: Screen;
}

export interface Tabs {
  list: readonly Tab[];
  /** The id of the tab in front; -1 once the last has closed. */
  active: number;
}

export const NO_TABS: Tabs = { list: [], active: -1 };

export function newTab(id: number): Tab {
  return { id, title: "Terminal", screen: EMPTY_SCREEN };
}

/** `tab` opened just after the one in front, and brought to the front. */
export function addTab(tabs: Tabs, tab: Tab): Tabs {
  const at = tabs.list.findIndex((each) => each.id === tabs.active);
  const list = [...tabs.list];
  list.splice(at < 0 ? list.length : at + 1, 0, tab);
  return { list, active: tab.id };
}

/** Without tab `id`; closing the one in front brings its right neighbor forward (its left one at the end). Empty once the last closes. */
export function closeTab(tabs: Tabs, id: number): Tabs {
  const at = tabs.list.findIndex((tab) => tab.id === id);
  if (at < 0) return tabs;
  const list = tabs.list.filter((tab) => tab.id !== id);
  if (list.length === 0) return NO_TABS;
  if (tabs.active !== id) return { list, active: tabs.active };
  return { list, active: (list[at] ?? list[at - 1] ?? list[0])?.id ?? -1 };
}

export function selectTab(tabs: Tabs, id: number): Tabs {
  return tabs.list.some((tab) => tab.id === id) ? { ...tabs, active: id } : tabs;
}

/** The tab `delta` places from the one in front, wrapping around (⇧❖[ and ⇧❖]). */
export function stepTab(tabs: Tabs, delta: number): Tabs {
  const count = tabs.list.length;
  if (count === 0) return tabs;
  const at = Math.max(
    0,
    tabs.list.findIndex((tab) => tab.id === tabs.active),
  );
  const next = tabs.list[(((at + delta) % count) + count) % count];
  return next ? { ...tabs, active: next.id } : tabs;
}

/** The tab at `index` in front (the View menu's rows, ❖1…❖9). */
export function showIndex(tabs: Tabs, index: number): Tabs {
  const tab = tabs.list[index];
  return tab ? { ...tabs, active: tab.id } : tabs;
}

/** Tab `id` changed by `change`; the others keep their identity, so their rows don't redraw. */
export function updateTab(tabs: Tabs, id: number, change: (tab: Tab) => Tab): Tabs {
  if (!tabs.list.some((tab) => tab.id === id)) return tabs;
  return { ...tabs, list: tabs.list.map((tab) => (tab.id === id ? change(tab) : tab)) };
}

export function activeTab(tabs: Tabs): Tab | undefined {
  return tabs.list.find((tab) => tab.id === tabs.active);
}
