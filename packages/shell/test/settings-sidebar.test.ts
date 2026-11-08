import { expect, test } from "bun:test";
import { paneGroups } from "../src/settings-app/panes.ts";
import { SIDEBAR_LIST, sidebarHeight } from "../src/settings-app/sidebar.tsx";
import { SETTINGS_WINDOW } from "../src/settings-app/view.tsx";

test("the sidebar's height: the strip, the rows, their gaps, the padding", () => {
  const { strip, paddingTop, paddingBottom } = SIDEBAR_LIST;
  expect(sidebarHeight([])).toBe(strip + paddingTop + paddingBottom);
  // One row; two rows 1 apart; two groups 10 apart.
  expect(sidebarHeight([1])).toBe(strip + paddingTop + 28 + paddingBottom);
  expect(sidebarHeight([2])).toBe(strip + paddingTop + 28 * 2 + 1 + paddingBottom);
  expect(sidebarHeight([1, 1])).toBe(strip + paddingTop + 28 * 2 + 10 + paddingBottom);
});

test("every pane fits the window at its default size, Graphics' too, so About is never cut off", () => {
  const groups = paneGroups().map((group) => group.length);
  expect(groups.reduce((sum, count) => sum + count, 0)).toBe(22);
  expect(sidebarHeight(groups)).toBeLessThanOrEqual(SETTINGS_WINDOW.height);
});
