import { describe, expect, test } from "bun:test";
import { appOf, MenuSource, menuActions } from "../src/actions/lib/sources/menus.ts";
import { ActionRegistry } from "../src/actions/registry.ts";
import { AppMenuStore } from "../src/app-menus/store.ts";
import { run, window } from "./support/actions-sources.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

describe("menus apps publish", () => {
  const owner = {
    pid: 40,
    sent: [] as unknown[],
    send(message: unknown) {
      this.sent.push(message);
    },
  };
  const store = new AppMenuStore();
  store.publish(owner, [
    {
      id: "file",
      title: "File",
      items: [
        { kind: "item", id: "new", label: "New Note", shortcut: "❖N", enabled: true },
        { kind: "separator" },
        { kind: "item", id: "export", label: "Export…", enabled: false },
        { kind: "item", id: "delete", label: "Delete Note", enabled: true, agents: false },
      ],
    },
    { id: "app", title: "", items: [{ kind: "item", id: "settings", label: "Settings…", enabled: true }] },
    { id: "view", title: "View", items: [{ kind: "item", id: "wrap", label: "Wrap Lines", enabled: true, checked: true }] },
  ]);

  test("rows read “Notes › File › New Note” with their shortcut; greyed-out ones are left out", () => {
    const published = store.published()[0];
    if (!published) throw new Error("nothing published");
    const actions = menuActions(published, { appId: "dev.dashi.notes", name: "Notes", window: 3 }, { store, focus: async () => {} });
    expect(actions.map((action) => [action.address, action.title, action.shortcut ?? null, action.kind])).toEqual([
      ["dashi://app/dev.dashi.notes/menu/new", "Notes › File › New Note", "❖N", "run"],
      ["dashi://app/dev.dashi.notes/menu/delete", "Notes › File › Delete Note", null, "run"],
      ["dashi://app/dev.dashi.notes/menu/settings", "Notes › Settings…", null, "run"],
      ["dashi://app/dev.dashi.notes/menu/wrap", "Notes › View › Wrap Lines", null, "toggle"],
    ]);
    // The person is choosing: items kept from agents are offered. A link only opens them.
    expect(actions.every((action) => action.who === "person" && action.destructive)).toBe(true);
    expect(actions[3]?.state?.()).toBe(true);
  });

  test("choosing brings the app's window forward and sends the menu's own select", async () => {
    const focused: number[] = [];
    let windows = [window(3, { pid: 41 })];
    const source = new MenuSource({
      store,
      windows: async () => windows,
      owners: (pid) => (pid === 41 ? [41, 40] : pid === null ? [] : [pid]),
      appName: () => "Notes",
      focus: async (id) => void focused.push(id),
    });
    await source.refresh();
    const registry = new ActionRegistry();
    registry.add(source);
    owner.sent.length = 0;
    expect(await run(registry.get("dashi://app/dev.dashi.notes/menu/new"))).toEqual({ ok: true, text: "Chose Notes › File › New Note." });
    expect(focused).toEqual([3]);
    expect(owner.sent).toEqual([{ type: "select", id: "new" }]);
    // No window of the app: its menus aren't anyone's to show.
    windows = [];
    await source.refresh();
    expect(registry.list()).toEqual([]);
    expect(appOf(40, [window(3, { pid: 41 })], { owners: () => [41, 40], appName: () => "Notes" })).toEqual({
      appId: "dev.dashi.notes",
      name: "Notes",
      window: 3,
    });
    source.close();
  });

  test("a windows read that fails on the settle timer is caught, and the actions stay as they were", async () => {
    let changed = () => {};
    const errors: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void errors.push(args);
    const source = new MenuSource({
      store,
      windows: () => Promise.reject(new Error("no compositor")),
      onWindows: (listener) => {
        changed = listener;
        return () => {};
      },
      owners: () => [],
      appName: () => "Notes",
      focus: async () => {},
    });
    try {
      changed();
      await settle(150);
      expect(errors.length).toBe(1);
      expect(source.actions()).toEqual([]);
    } finally {
      console.error = error;
      source.close();
    }
  });
});
