import { describe, expect, test } from "bun:test";
import { RadioSource } from "../src/actions/radios.ts";
import type { CompositorWindow } from "../src/compositor.ts";
import { actionKind, entryAddress, type LauncherItem, type LauncherWindow, launcherIndex, launcherItems } from "../src/launcher/lib/items.ts";
import { buildSections, type ListInput, selectable } from "../src/launcher/lib/rows.ts";
import { aliasIndex } from "../src/launcher/person-keys.ts";
import { rank } from "../src/launcher/ranking/index.ts";
import { actionRow, fileNameMatches, shortFolder, windowRow } from "../src/launcher/row-model.ts";
import { desktopWord, launcherWindows } from "../src/launcher/world.ts";
import { action, app, darkMode, ICONS, window } from "./support/launcher-fixtures.ts";

describe("what the launcher lists", () => {
  test("registry actions: settings rows, commands, menus and Desktop Actions; not the apps or panes twice, not windows by address", () => {
    expect(actionKind(darkMode(true))).toBe("setting");
    expect(actionKind(action("dashi://settings/appearance", { source: "settings", place: { pane: "appearance" } }))).toBeNull();
    expect(actionKind(action("dashi://app/firefox", { source: "apps" }))).toBeNull();
    expect(actionKind(action("dashi://app/firefox/action/new-private", { source: "apps" }))).toBe("command");
    expect(actionKind(action("dashi://window/w3", { source: "windows" }))).toBeNull();
    expect(actionKind(action("dashi://window/arrange/left", { source: "windows" }))).toBe("command");
    expect(actionKind(action("dashi://app/notes/menu/new", { source: "menus" }))).toBe("menu");
    expect(actionKind(action("dashi://tool/lock-screen", { source: "tools", who: "both" }))).toBe("command");
    expect(actionKind(action("dashi://tool/set-volume", { source: "tools", who: "both", required: ["level"] }))).toBeNull();
  });

  test("one row per thing: Dashi's System Settings command is the System Settings app", () => {
    const items = launcherItems({
      entries: [app("System Settings", { id: "dev.dashi.settings" })],
      actions: [action("dashi://dashi/settings", { title: "System Settings" }), action("dashi://dashi/lock-screen", { title: "Lock Screen" })],
    });
    expect(items.map((item) => item.names[0])).toEqual(["System Settings", "Lock Screen"]);
    expect(items[0]?.address).toBe("dashi://app/dev.dashi.settings");
    expect(entryAddress({ id: "dev.dashi.settings/appearance" })).toBe("dashi://settings/appearance");
  });

  test("agent tools: no row for one that only reads, one row with Dashi's command of the same name, no model-facing detail", () => {
    expect(actionKind(action("dashi://tool/list-windows", { source: "tools", who: "both", readOnly: true }))).toBeNull();
    expect(actionKind(action("dashi://tool/set-volume", { source: "tools", who: "both", properties: { level: { type: "number" } } }))).toBeNull();
    const items = launcherItems({
      entries: [],
      actions: [
        action("dashi://dashi/lock-screen", { title: "Lock Screen", source: "dashi" }),
        action("dashi://tool/lock-screen", { title: "Lock the screen", source: "tools", who: "both" }),
        action("dashi://tool/record-screen", { title: "Record the screen", source: "tools", who: "both", description: "For a model." }),
      ],
    });
    expect(items.map((item) => item.id)).toEqual(["dashi://dashi/lock-screen", "dashi://tool/record-screen"]);
    const row = actionRow(items[1] as LauncherItem, { app: () => undefined, dashi: "/dashi.svg" });
    expect(row.detail).toBeUndefined();
  });

  test("a Settings pane doesn't hide the command of the same name (Lock Screen, the VM run)", () => {
    const items = launcherItems({
      entries: [app("Lock Screen", { id: "dev.dashi.settings/lock-screen" })],
      actions: [action("dashi://dashi/lock-screen", { title: "Lock Screen" })],
    });
    expect(items.map((item) => item.kind)).toEqual(["pane", "command"]);
  });

  test("a window title is found but never above an exact app name; the index is built once per set of lists", () => {
    const entries = [app("Files", { id: "dev.dashi.files" })];
    const windows = [window(3, "Files", "dev.dashi.files")];
    const input: ListInput = {
      query: "files",
      entries,
      recent: [],
      files: { kind: "none" },
      icons: ICONS,
      windows,
      index: launcherIndex({ entries, windows }),
    };
    const rows = selectable(buildSections(input));
    expect(rows[0]?.title).toBe("Files");
    expect(rows[0]?.group).toBe("app");
    expect(rows[0]?.detail).toBe("1 window");
    expect(rows[0]?.action.kind).toBe("focus");
    expect(rows.some((row) => row.id === "window:3")).toBe(true);
    expect(launcherIndex({ entries, windows })).toBe(input.index as ReturnType<typeof launcherIndex>);
  });

  test("a setting shows its switch; an alias is matched first and shown as a badge", () => {
    const entries = [app("Firefox"), app("Files")];
    const actions = [darkMode(true)];
    const index = launcherIndex({ entries, actions });
    const base: ListInput = { query: "dark", entries, recent: [], files: { kind: "none" }, icons: ICONS, index };
    expect(selectable(buildSections(base))[0]).toMatchObject({ title: "Dark Mode", control: { kind: "switch", on: true }, action: { kind: "reveal" } });
    const aliased = selectable(buildSections({ ...base, query: "ff", aliases: aliasIndex({ ff: "dashi://app/app.files" }) }));
    expect(aliased[0]).toMatchObject({ title: "Files", badge: "ff" });
  });

  test("files answer only as names do, and say where they are briefly", () => {
    expect(fileNameMatches("sunset.png", "set")).toBe(false);
    expect(fileNameMatches("tea-notes.md", "tea no")).toBe(true);
    expect(fileNameMatches("TeaParty.txt", "party")).toBe(true);
    expect(shortFolder("~/Documents")).toBe("~/Documents");
    expect(shortFolder("~/Developer/dashi/target/release/build")).toBe("~/…/build");
    expect(shortFolder("/usr/share/icons/hicolor")).toBe("/…/hicolor");
  });

  test("the Try list shows Wi-Fi only when it lands on the Wi-Fi switch", () => {
    const entries = [app("Network", { id: "dev.dashi.settings/network", keywords: ["wi-fi", "wifi"] })];
    const wifi = action("dashi://settings/network/wi-fi", { title: "Wi-Fi", kind: "toggle", source: "controls", place: { pane: "network", row: "wi-fi" } });
    const without = buildSections({ query: "", entries, recent: [], files: { kind: "none" }, icons: ICONS, index: launcherIndex({ entries }) });
    expect(without[0]?.rows.map((row) => row.id)).not.toContain("try:wi-fi");
    const withWifi = buildSections({
      query: "",
      entries,
      recent: [],
      files: { kind: "none" },
      icons: ICONS,
      index: launcherIndex({ entries, actions: [wifi] }),
    });
    expect(withWifi[0]?.rows.map((row) => row.id)).toContain("try:wi-fi");
  });
});

describe("the windows, as the switcher names them", () => {
  test("most recent app first, the shell's own surfaces left out, the Desktop said when it isn't this one", () => {
    const raw = (id: number, appId: string, space = 0): CompositorWindow => ({
      id,
      appId,
      title: `${appId} ${id}`,
      pid: id,
      focused: false,
      state: "normal",
      frame: null,
      titleBar: 0,
      space,
    });
    const listed = launcherWindows([raw(1, "files"), raw(2, "dev.dashi.shell"), raw(3, "notes", 1), raw(4, "files")], {
      appOf: (each) => ({ entryId: `dev.dashi.${each.appId}`, name: each.appId, icon: "/i.svg" }),
      desktopOf: (each) => (each.space === 1 ? "Desktop 2" : undefined),
    });
    expect(listed.map((each) => each.id)).toEqual([1, 4, 3]);
    expect(listed[2]).toMatchObject({ address: "dashi://window/w3", desktop: "Desktop 2", entryId: "dev.dashi.notes" });
  });
});

describe("the radios", () => {
  test("Wi-Fi and Bluetooth read Control Center's store; no hardware, no row; Space flips", async () => {
    let wifi: boolean | null = false;
    let bluetooth: boolean | null = null;
    const listeners = new Set<() => void>();
    const source = new RadioSource({
      wifi: () => wifi,
      bluetooth: () => bluetooth,
      network: () => "Home-5G",
      setWifi: async (on) => {
        wifi = on;
      },
      setBluetooth: async (on) => {
        bluetooth = on;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    expect(source.actions().map((each) => each.address)).toEqual(["dashi://settings/network/wi-fi"]);
    const [radio] = source.actions();
    expect(radio?.description).toBe("Off");
    const checked = radio?.check({});
    if (!checked?.ok) throw new Error("not ready");
    await checked.run({ window: null });
    expect(wifi).toBe(true);
    expect(radio?.description).toBe("Home-5G");
    bluetooth = true;
    let changed = 0;
    source.subscribe(() => changed++);
    for (const listener of listeners) listener();
    expect(changed).toBe(1);
    expect(source.actions()).toHaveLength(2);
    source.close();
  });
});

describe("menu rows answer to their own words", () => {
  const sortByDate = action("dashi://app/notes/menu/sort-date", {
    source: "menus",
    title: "Notes › View › Sort by Date",
    keywords: { en: ["sort by date", "view", "notes"] },
  });
  const newNote = action("dashi://app/notes/menu/new", { source: "menus", title: "Notes › File › New Note", keywords: { en: ["new note", "file", "notes"] } });
  const index = launcherIndex({ entries: [app("Notes", { id: "dev.dashi.notes" })], actions: [sortByDate, newNote] });
  const found = (query: string) => rank(index, query).map((result) => result.item.id);

  test("the app's name or the menu's alone finds no menu row", () => {
    expect(found("no")).not.toContain(sortByDate.address);
    expect(found("notes")).not.toContain(sortByDate.address);
    expect(found("view")).not.toContain(sortByDate.address);
  });

  test("the item's words find it, and the app or the menu narrows them", () => {
    expect(found("sort")).toContain(sortByDate.address);
    expect(found("notes sort")).toContain(sortByDate.address);
    expect(found("view sort")).toContain(sortByDate.address);
    expect(found("new note")[0]).toBe(newNote.address);
    expect(found("notes new")).toContain(newNote.address);
    expect(found("notes new")).not.toContain(sortByDate.address);
  });
});

describe("a window row's Desktop", () => {
  test("its name, unless the name only repeats the app: then its place", () => {
    expect(desktopWord("Work", "Terminal", 1)).toBe("Work");
    expect(desktopWord("Terminal", "Terminal", 1)).toBe("Desktop 2");
    expect(desktopWord(" terminal ", "Terminal", 2)).toBe("Desktop 3");
    expect(desktopWord("Terminal, Files", "Terminal", 1)).toBe("Terminal, Files");
    expect(desktopWord(undefined, "Terminal", 0)).toBe("Desktop 1");
  });
});

describe("a window row's words", () => {
  const window = (title: string, extra: Partial<LauncherWindow> = {}): LauncherWindow => ({
    id: 3,
    address: "dashi://window/w3",
    title,
    appName: "Notes",
    entryId: "dev.dashi.notes",
    state: "normal",
    icon: "/notes.svg",
    ...extra,
  });

  test("the app's name follows the title, but never repeats it", () => {
    expect(windowRow(window("Groceries")).detail).toBe("Notes");
    expect(windowRow(window("Notes")).detail).toBeUndefined();
    expect(windowRow(window("Notes", { desktop: "Desktop 2" })).detail).toBe("Desktop 2");
    expect(windowRow(window("Groceries", { state: "minimized" })).detail).toBe("Notes · minimized");
  });
});
