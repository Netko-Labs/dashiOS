/**
 * A Terminal window's tabs: one dashi-term each, in the order the title
 * bar shows them, one of them in front. Pure: the view keeps a `Tabs` in
 * state, the engines beside it keyed by the tab's id, and each tab's screen
 * in the store (store.ts), so a frame doesn't re-render the tabs.
 */

import { type Naming, UNNAMED } from "./naming.ts";

export interface Tab {
  id: number;
  /** What it is called (naming.ts). */
  naming: Naming;
  /** The bell rang while the tab was behind another: a dot on it until it comes forward. */
  rang: boolean;
  /** Its engine went away without the shell exiting: the grid says so and Return starts another. */
  lost: boolean;
}

export interface Tabs {
  list: readonly Tab[];
  /** The id of the tab in front; -1 once the last has closed. */
  active: number;
}

export const NO_TABS: Tabs = { list: [], active: -1 };

export function newTab(id: number): Tab {
  return { id, naming: UNNAMED, rang: false, lost: false };
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
  return front({ list, active: (list[at] ?? list[at - 1] ?? list[0])?.id ?? -1 });
}

/** The tab in front has been seen: its bell dot goes. */
function front(tabs: Tabs): Tabs {
  const tab = activeTab(tabs);
  return tab?.rang ? updateTab(tabs, tab.id, (each) => ({ ...each, rang: false })) : tabs;
}

export function selectTab(tabs: Tabs, id: number): Tabs {
  return tabs.list.some((tab) => tab.id === id) ? front({ ...tabs, active: id }) : tabs;
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
  return next ? selectTab(tabs, next.id) : tabs;
}

/** The tab at `index` in front (the View menu's rows, ❖1…❖9). */
export function showIndex(tabs: Tabs, index: number): Tabs {
  const tab = tabs.list[index];
  return tab ? selectTab(tabs, tab.id) : tabs;
}

/** Tab `id` changed by `change`; the same object when nothing changed, so the window doesn't re-render. */
export function updateTab(tabs: Tabs, id: number, change: (tab: Tab) => Tab): Tabs {
  let changed = false;
  const list = tabs.list.map((tab) => {
    if (tab.id !== id) return tab;
    const next = change(tab);
    changed = next !== tab;
    return next;
  });
  return changed ? { ...tabs, list } : tabs;
}

/** The bell rang in tab `id`: a dot when it is behind another (the one in front flashes instead). */
export function ring(tabs: Tabs, id: number): Tabs {
  return id === tabs.active ? tabs : updateTab(tabs, id, (tab) => (tab.rang ? tab : { ...tab, rang: true }));
}

export function activeTab(tabs: Tabs): Tab | undefined {
  return tabs.list.find((tab) => tab.id === tabs.active);
}
