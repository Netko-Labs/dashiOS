import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppMenuStore, type MenuOwner } from "../src/app-menus/store.ts";
import { publishEditMenu } from "../src/settings-app/edit-menu.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import type { AppMenu } from "../src/shared/app-menus/protocol.ts";
import { flush } from "./support/time.ts";

let root = "";
let store: SettingsStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-settings-undo-"));
  store = new SettingsStore(join(root, "settings.json"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("a change that is one value can be undone back to the default, and redone", async () => {
  store.patch("clock", { hour24: true });
  expect(store.undo.state.undoName).toBe("24-Hour Time");
  await store.undo.undo();
  expect(store.getSnapshot().data.clock.hour24).toBeUndefined();
  await store.undo.redo();
  expect(store.getSnapshot().data.clock.hour24).toBe(true);
});

test("a change of several values is one step; a change nobody makes by hand is none", async () => {
  store.patch("clock", { hour24: true, showDate: false });
  expect(store.undo.state.undoName).toBe("24-Hour Time");
  await store.undo.undo();
  expect(store.getSnapshot().data.clock).toEqual({});
  store.patch("spaces", { count: 3 });
  expect(store.undo.state.canRedo).toBe(true);
  expect(store.changes.getSnapshot()).toHaveLength(1);
  store.patch("menuBar", { batteryPercent: true });
  store.patch("menuBar", { batteryPercent: true });
  expect(store.undo.state.undoName).toBe("Battery Percentage");
});

test("the Edit menu is published as the window's process and its rows undo", async () => {
  const published: Array<{ pid: number; menus: readonly AppMenu[] }> = [];
  let owner: MenuOwner | null = null;
  let withdrawn = 0;
  let looks = 0;
  const menu = publishEditMenu(
    {
      publish: (who, menus) => {
        owner = who;
        published.push({ pid: who.pid, menus });
      },
      withdraw: () => void withdrawn++,
    },
    store.undo,
    // The window shows on the second look.
    async () => (++looks >= 2 ? 4242 : null),
    async () => {},
  );
  await flush();
  await flush();
  expect(published.at(-1)?.pid).toBe(4242);
  expect(published.at(-1)?.menus[0]?.items[0]).toMatchObject({ id: "undo", label: "Undo", enabled: false });

  store.patch("clock", { showDate: false });
  expect(published.at(-1)?.menus[0]?.items[0]).toMatchObject({ label: "Undo Show Date", enabled: true });
  // No search to go to: no Find.
  expect(published.at(-1)?.menus[0]?.items.some((item) => item.kind === "item" && item.id === "find")).toBe(false);
  (owner as MenuOwner | null)?.send({ type: "select", id: "undo" });
  await flush();
  expect(store.getSnapshot().data.clock.showDate).toBeUndefined();
  menu.stop();
  expect(withdrawn).toBe(1);
});

test("while a field in Settings has the keyboard, ❖Z and ❖A are the field's, not the Edit menu's", async () => {
  const menus = new AppMenuStore();
  const menu = publishEditMenu(
    menus,
    store.undo,
    async () => 4343,
    async () => {},
  );
  await flush();
  store.patch("clock", { showDate: false });
  expect(menus.menusFor([4343])?.typing).toBeUndefined();

  menu.setTyping(true);
  expect(menus.menusFor([4343])?.typing).toBe(true);
  // The field answers: the shell sends the Ctrl chord to the window instead (shortcuts.ts).
  expect(menus.shortcut([4343], "❖Z")).toBe(false);
  expect(menus.shortcut([4343], "❖A")).toBe(false);
  expect(store.getSnapshot().data.clock.showDate).toBe(false);

  menu.setTyping(false);
  expect(menus.shortcut([4343], "❖Z")).toBe(true);
  await flush();
  expect(store.getSnapshot().data.clock.showDate).toBeUndefined();
  menu.stop();
});
