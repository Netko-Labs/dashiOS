import { expect, test } from "bun:test";
import { SIDEBAR, sidebarListHeight, topBand } from "../src/settings-app/lib/sidebar-measures.ts";
import { SETTINGS_WINDOW } from "../src/settings-app/view.tsx";
import { GROUP_LABELS, PANES, paneGroups, SIDEBAR_PANES } from "../src/shared/settings/panes.ts";

const ids = (panes: readonly { id: string }[]) => panes.map((pane) => pane.id);

test("the sidebar's groups: the look first with no label, then Connect, This laptop, You", () => {
  const groups = paneGroups();
  expect(groups.map((group) => group.label)).toEqual([null, "Connect", "This laptop", "You"]);
  expect(groups.map((group) => group.group)).toEqual(["look", "connect", "laptop", "you"]);
  expect(GROUP_LABELS.look).toBeNull();
});

test("the panes the design drew come first in their groups, in its order", () => {
  const [look, connect, laptop, you] = paneGroups().map((group) => ids(group.panes));
  expect(look?.slice(0, 5)).toEqual(["appearance", "wallpaper", "displays", "desktop-dock", "control-center"]);
  expect(connect).toEqual(["network", "bluetooth", "sound"]);
  expect(laptop?.slice(0, 4)).toEqual(["battery", "graphics", "keyboard", "trackpad"]);
  expect(you?.slice(0, 4)).toEqual(["users", "passwords", "agents", "privacy"]);
});

test("every pane is in the sidebar once, Recently changed included, and named as drawn", () => {
  expect(SIDEBAR_PANES.length).toBe(23);
  expect(new Set(ids(SIDEBAR_PANES)).size).toBe(SIDEBAR_PANES.length);
  expect(paneGroups().flatMap((group) => ids(group.panes))).toEqual(ids(PANES));
  const title = (id: string) => PANES.find((pane) => pane.id === id)?.title;
  expect([title("network"), title("users"), title("privacy"), title("recent")]).toEqual(["Wi-Fi", "Users", "Privacy", "Recently changed"]);
});

test("without a graphics card, This laptop has no Graphics and the order holds", () => {
  const groups = paneGroups(SIDEBAR_PANES.filter((pane) => !pane.optional));
  expect(ids(groups[2]?.panes ?? [])).toEqual(["battery", "keyboard", "trackpad", "mouse", "about"]);
});

test("the list's height: rows 30, 1 apart, a 22 label over each group but the first", () => {
  expect(sidebarListHeight([])).toBe(0);
  expect(sidebarListHeight([1])).toBe(30);
  expect(sidebarListHeight([2])).toBe(61);
  expect(sidebarListHeight([1, 1])).toBe(30 * 2 + 1 + SIDEBAR.label + 1);
});

test("the window is the design's height, so the sidebar scrolls; the chosen pane is kept in view instead", () => {
  const groups = paneGroups().map((group) => group.panes.length);
  expect(SETTINGS_WINDOW.height).toBe(640);
  expect(sidebarListHeight(groups) + SIDEBAR.bar).toBeGreaterThan(SETTINGS_WINDOW.height);
});

test("the search row is centred on the window lights; the band stays the design's height", () => {
  expect(topBand(null)).toEqual({ row: SIDEBAR.bar - SIDEBAR.paddingTop, below: 0 });
  // dashi-comp's lights: a 12 row 13 down, centred at 19; the search's row centres there too.
  const band = topBand({ x: 14, y: 13, width: 56, height: 12 });
  expect(SIDEBAR.paddingTop + band.row / 2).toBe(19);
  expect(SIDEBAR.paddingTop + band.row + band.below).toBe(SIDEBAR.bar);
  // The pill fits its row, so it is centred on the lights, not pushed down.
  expect(band.row).toBeGreaterThanOrEqual(SIDEBAR.search);
  // Lights lower down: a taller row, still centred on them, and nothing below.
  const low = topBand({ x: 14, y: 30, width: 56, height: 12 });
  expect(SIDEBAR.paddingTop + low.row / 2).toBe(36);
  expect(low.below).toBe(0);
});
