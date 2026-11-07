import { expect, test } from "bun:test";
import { activeTab, addTab, closeTab, NO_TABS, newTab, ring, selectTab, showIndex, stepTab, type Tabs, updateTab } from "../apps/terminal/tabs.ts";

const ids = (tabs: Tabs): number[] => tabs.list.map((tab) => tab.id);
const three = (): Tabs => addTab(addTab(addTab(NO_TABS, newTab(1)), newTab(2)), newTab(3));

test("a new tab opens after the one in front and comes forward", () => {
  const tabs = selectTab(three(), 1);
  const added = addTab(tabs, newTab(4));
  expect(ids(added)).toEqual([1, 4, 2, 3]);
  expect(added.active).toBe(4);
});

test("closing the tab in front brings its right neighbor forward, or its left at the end", () => {
  expect(closeTab(selectTab(three(), 2), 2)).toMatchObject({ active: 3 });
  expect(closeTab(three(), 3)).toMatchObject({ active: 2 });
  expect(closeTab(selectTab(three(), 1), 3)).toMatchObject({ active: 1 });
  expect(closeTab(addTab(NO_TABS, newTab(1)), 1)).toEqual(NO_TABS);
  expect(closeTab(three(), 9)).toEqual(three());
});

test("stepping wraps around both ends", () => {
  expect(stepTab(three(), 1).active).toBe(1);
  expect(stepTab(selectTab(three(), 1), -1).active).toBe(3);
  expect(stepTab(NO_TABS, 1)).toEqual(NO_TABS);
});

test("a View menu row brings its tab forward", () => {
  expect(showIndex(three(), 0).active).toBe(1);
  expect(showIndex(three(), 7)).toEqual(three());
});

test("updating one tab keeps the others' identity, and the list's when nothing changed", () => {
  const tabs = three();
  const updated = updateTab(tabs, 2, (tab) => ({ ...tab, lost: true }));
  expect(updated.list[1]?.lost).toBe(true);
  expect(updated.list[0]).toBe(tabs.list[0] as never);
  expect(activeTab(updated)?.id).toBe(3);
  expect(updateTab(tabs, 9, (tab) => tab)).toBe(tabs);
  expect(updateTab(tabs, 2, (tab) => tab)).toBe(tabs);
});

test("the bell marks a tab behind the front one, until it comes forward", () => {
  const tabs = three();
  expect(ring(tabs, 3)).toBe(tabs);
  const rang = ring(tabs, 1);
  expect(rang.list[0]?.rang).toBe(true);
  expect(ring(rang, 1)).toBe(rang);
  expect(selectTab(rang, 1).list[0]?.rang).toBe(false);
  expect(stepTab(rang, 1).list[0]?.rang).toBe(false);
});
