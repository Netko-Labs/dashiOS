import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppMenu } from "../src/app-menus/protocol.ts";
import type { MenuOwner } from "../src/app-menus/store.ts";
import { publishEditMenu } from "../src/settings-app/edit-menu.ts";
import { settingName } from "../src/settings-app/history.ts";
import { SettingsStore } from "../src/settings-app/store.ts";

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

test("a change of several values, or none, is not on the stack", () => {
  store.patch("clock", { hour24: true, showDate: false });
  expect(store.undo.state.canUndo).toBe(false);
  store.patch("menuBar", { batteryPercent: true });
  store.patch("menuBar", { batteryPercent: true });
  expect(store.undo.state.undoName).toBe("Battery Percentage");
  expect(settingName("wallpaper", "photo")).toBe("Setting Change");
});

test("the Edit menu is published as the window's process and its rows undo", async () => {
  const published: Array<{ pid: number; menus: readonly AppMenu[] }> = [];
  let owner: MenuOwner | null = null;
  let withdrawn = 0;
  let looks = 0;
  const stop = publishEditMenu(
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(published.at(-1)?.pid).toBe(4242);
  expect(published.at(-1)?.menus[0]?.items[0]).toMatchObject({ id: "undo", label: "Undo", enabled: false });

  store.patch("clock", { showDate: false });
  expect(published.at(-1)?.menus[0]?.items[0]).toMatchObject({ label: "Undo Show Date", enabled: true });
  (owner as MenuOwner | null)?.send({ type: "select", id: "undo" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.getSnapshot().data.clock.showDate).toBeUndefined();
  stop();
  expect(withdrawn).toBe(1);
});
