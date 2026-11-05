import { describe, expect, test } from "bun:test";
import { RadioSource } from "../src/actions/sources/radios.ts";
import { type ActionDef, ok, ready } from "../src/actions/types.ts";
import type { CompositorWindow } from "../src/compositor.ts";
import type { Entry } from "../src/entries.ts";
import { KEYMAP } from "../src/keymap.ts";
import { aliasRows, aliasToKeep, mayKeep, shortcutRows } from "../src/launcher/editing.ts";
import { actionKind, entryAddress, type LauncherItem, type LauncherWindow, launcherIndex, launcherItems } from "../src/launcher/items.ts";
import { LAUNCHER_RULES, LauncherKeys, withLauncher } from "../src/launcher/keys.ts";
import {
  aliasIndex,
  chordWhen,
  collision,
  isAliasMap,
  isKeyMap,
  isPersonChord,
  keyOf,
  personRules,
  RECORD_RULES,
  withAlias,
  withKey,
} from "../src/launcher/person-keys.ts";
import { LauncherPrefs, type PrefsStore } from "../src/launcher/prefs.ts";
import { actionRow } from "../src/launcher/row-model.ts";
import { buildSections, fileNameMatches, type ListInput, selectable, shortFolder } from "../src/launcher/rows.ts";
import { describeBinding } from "../src/launcher/shell-host.ts";
import { filterVerbs, hintFor, presentedVerbs, spaceFlips, verbsFor } from "../src/launcher/verbs.ts";
import { launcherWindows } from "../src/launcher/world.ts";
import type { LauncherSettings } from "../src/settings-app/store.ts";

const app = (name: string, extra: Partial<Entry> = {}): Entry => ({ id: `app.${name.toLowerCase()}`, name, icon: `/${name}.svg`, keywords: [], ...extra });
const ICONS = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg", command: "/dashi.svg" };

function action(address: string, extra: Partial<ActionDef> = {}): ActionDef {
  return {
    address,
    title: "Thing",
    description: "",
    keywords: { en: [] },
    kind: "run",
    properties: {},
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source: "dashi",
    check: () => ready(async () => ok("Done.")),
    ...extra,
  };
}

const window = (id: number, title: string, entryId: string | null, extra: Partial<LauncherWindow> = {}): LauncherWindow => ({
  id,
  address: `dashi://window/w${id}`,
  title,
  appName: entryId ? (entryId.split(".")[1] ?? "") : "Thing",
  entryId,
  state: "normal",
  icon: "/w.svg",
  ...extra,
});

const darkMode = (on: boolean) =>
  action("dashi://settings/appearance/dark-mode", {
    title: "Dark Mode",
    kind: "toggle",
    source: "settings",
    place: { pane: "appearance", row: "dark-mode" },
    keywords: { en: ["dark", "theme", "dark mode"] },
    state: () => on,
  });

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

describe("a row's actions", () => {
  const files = app("Files", { id: "dev.dashi.files" });
  const windows = [window(3, "Downloads", "dev.dashi.files", { desktop: "Desktop 2" }), window(4, "Report", "dev.dashi.files")];
  const rowOf = (query: string, extra: Partial<ListInput> = {}) => {
    const entries = [files, ...(extra.entries ?? [])];
    const input: ListInput = {
      query,
      entries,
      recent: [],
      files: { kind: "none" },
      icons: ICONS,
      windows,
      index: launcherIndex({ entries, windows }),
      ...extra,
    };
    return selectable(buildSections(input))[0];
  };

  test("an app with windows switches, opens a new one, brings one here, and quits after asking", () => {
    const row = rowOf("files");
    const verbs = verbsFor(row as NonNullable<typeof row>, { windows, pinned: () => false });
    expect(verbs.map((each) => [each.title, each.key ?? ""])).toEqual([
      ["Switch to window", "↩"],
      ["New window", "❖↩"],
      ["Bring here from Desktop 2", "⌥↩"],
      ["Switch to “Report”", ""],
      ["Keep in Dock", ""],
      ["Set alias…", "⇧❖A"],
      ["Set shortcut…", "⇧❖K"],
      ["Copy Address", "❖C"],
      ["Quit Files", "❖Q"],
      ["Reset Ranking", ""],
      ["Reset All Ranking", ""],
    ]);
    const quit = verbs.find((each) => each.id === "quit");
    expect(quit).toMatchObject({ danger: true, confirm: "Quit Files and close its 2 windows?" });
    expect(hintFor(row, { windows }).map((hint) => hint.keys)).toEqual(["↩", "❖↩", "❖K"]);
  });

  test("a setting opens at its row and flips with Space; Space types on when it continues the name", () => {
    const entries = [app("Firefox")];
    const actions = [darkMode(false)];
    const input: ListInput = { query: "dark", entries, recent: [], files: { kind: "none" }, icons: ICONS, index: launcherIndex({ entries, actions }) };
    const row = selectable(buildSections(input))[0];
    const verbs = verbsFor(row as NonNullable<typeof row>, { windows: [] });
    expect(verbs.slice(0, 2).map((each) => [each.title, each.key])).toEqual([
      ["Open in Settings", "↩"],
      ["Turn Dark Mode on", "Space"],
    ]);
    expect(spaceFlips(row, "dark")).toBe(false);
    expect(spaceFlips(row, "dark mode")).toBe(true);
    expect(spaceFlips(row, "dar")).toBe(true);
    expect(hintFor(row, { windows: [] })[0]).toEqual({ keys: "Space", label: "toggles" });
  });

  test("the field filters the list, and a link's action runs only on Return, never when its arguments don't fit", () => {
    const row = rowOf("files");
    const verbs = verbsFor(row as NonNullable<typeof row>, { windows });
    expect(filterVerbs(verbs, "copy").map((each) => each.title)).toEqual(["Copy Address"]);
    const strict = action("dashi://tool/set-volume", {
      title: "Set the volume",
      check: (args) => (typeof args.level === "number" ? ready(async () => ok("Done.")) : { ok: false, error: "`level` must be a number" }),
    });
    expect(presentedVerbs(strict, { level: 30 }, { windows: [] }).map((each) => each.title)).toEqual(["Set the volume", "Copy Address"]);
    expect(presentedVerbs(strict, { level: "loud" }, { windows: [] }).map((each) => each.title)).toEqual(["Copy Address"]);
  });
});

describe("the person's aliases and keys", () => {
  test("chords a person's key may be, as the binding reports them", () => {
    expect(isPersonChord("super+alt+n")).toBe(true);
    expect(isPersonChord("alt+n")).toBe(false);
    expect(isPersonChord("super+super+n")).toBe(false);
    expect(chordWhen({ key: "n", shift: true, ctrl: false, alt: true })).toBe("super+alt+shift+n");
    expect(isKeyMap({ "super+alt+n": "dashi://app/dev.dashi.notes/menu/new" })).toBe(true);
    expect(isKeyMap({ "super+alt+n": "https://example.com" })).toBe(false);
    expect(isAliasMap({ ff: "dashi://app/org.mozilla.firefox" })).toBe(true);
    expect(isAliasMap({ " ff": "dashi://app/org.mozilla.firefox" })).toBe(false);
  });

  test("what a chord already does: free in Dashi's reserved room, taken by a Dashi key or an app's Ctrl chord, refused for the compositor's own", () => {
    expect(collision("super+alt+n", KEYMAP)).toEqual({ kind: "free" });
    expect(collision("super+ctrl+q", KEYMAP, (bind) => (bind === "lock-screen" ? "Lock Screen" : bind))).toEqual({ kind: "taken", does: "Lock Screen" });
    expect(collision("super+n", KEYMAP)).toEqual({ kind: "taken", does: "the app's own Ctrl shortcut" });
    expect(collision("super+ctrl+Escape", KEYMAP)).toEqual({ kind: "reserved" });
    expect(describeBinding("quit-app", () => undefined)).toBe("Quit app");
  });

  test("one alias per address and one address per alias; the same for keys; keys become rules", () => {
    expect(withAlias({ ff: "dashi://a", x: "dashi://b" }, "dashi://b", "ff")).toEqual({ ff: "dashi://b" });
    expect(withAlias({ ff: "dashi://a" }, "dashi://a", null)).toEqual({});
    expect(withKey({ "super+alt+n": "dashi://a" }, "dashi://b", "super+alt+n")).toEqual({ "super+alt+n": "dashi://b" });
    expect(personRules({ "super+alt+n": "dashi://a", "alt+x": "dashi://b" })).toEqual([{ when: "super+alt+n", bind: "dashi://a" }]);
    expect(keyOf({ "super+alt+n": "dashi://a" }, "dashi://a")).toBe("⌥❖N");
  });

  test("the editing rows: an alias says which address it moves from; a reserved chord can't be kept", () => {
    expect(aliasToKeep(" ff ")).toBe("ff");
    expect(aliasToKeep("!!")).toBeNull();
    const rows = aliasRows("ff", "Files", "dashi://app/files", aliasIndex({ ff: "dashi://app/firefox" }), () => "Firefox");
    expect(rows[0]).toMatchObject({ title: "Use “ff” for Files", detail: "instead of Firefox" });
    expect(shortcutRows(null, "Files", null)[0]?.title).toBe("Press the keys for Files");
    expect(shortcutRows("super+ctrl+Escape", "Files", { kind: "reserved" })[0]?.id).toBe("shortcut:reserved");
    expect(mayKeep("super+ctrl+Escape", { kind: "reserved" })).toBe(false);
    expect(mayKeep("super+alt+n", { kind: "free" })).toBe(true);
  });

  test("the prefs follow settings.json: what is saved is what the next snapshot reads", () => {
    let launcher: LauncherSettings = {};
    const listeners = new Set<() => void>();
    const store: PrefsStore = {
      getSnapshot: () => ({ data: { launcher } }),
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      patch: (_section, change) => {
        launcher = Object.fromEntries(Object.entries({ ...launcher, ...change }).filter(([, value]) => value !== undefined));
        for (const listener of listeners) listener();
      },
    };
    const prefs = new LauncherPrefs(store);
    prefs.setAlias("dashi://app/files", "fi");
    prefs.setKey("dashi://app/files", "super+alt+f");
    expect(prefs.getSnapshot().aliasOf("dashi://app/files")).toBe("fi");
    expect(prefs.getSnapshot().keyOf("dashi://app/files")).toBe("⌥❖F");
    expect(prefs.rules()).toEqual([{ when: "super+alt+f", bind: "dashi://app/files" }]);
    prefs.setKey("dashi://app/files", null);
    expect(launcher.keys).toBeUndefined();
  });
});

describe("the launcher's keys", () => {
  test("its commands come first, ⇧ rules ahead of the same key without; recording puts every ❖ chord first", () => {
    const whens = LAUNCHER_RULES.map((rule) => rule.when);
    expect(whens.indexOf("super+shift+k")).toBeLessThan(whens.indexOf("super+k"));
    expect(whens).toContain("super+9");
    expect(withLauncher(KEYMAP, true).rules.slice(0, RECORD_RULES.length)).toEqual(RECORD_RULES);
  });

  test("bindings become commands; a recorded chord only while recording", () => {
    const keys = new LauncherKeys();
    const heard: string[] = [];
    keys.subscribeCommands((command) => heard.push(command.kind === "pick" ? `pick ${command.digit}` : command.kind));
    let recordingKeymap = 0;
    keys.onRecording = () => recordingKeymap++;
    expect(keys.binding("launcher-actions")).toBe(true);
    expect(keys.binding("launcher-pick-3")).toBe(true);
    keys.binding("launcher-record", { key: "n", shift: false, ctrl: false, alt: true });
    keys.record(true);
    keys.binding("launcher-record", { key: "n", shift: false, ctrl: false, alt: true });
    expect(keys.digits(true)).toBe(true);
    expect(heard).toEqual(["actions", "pick 3", "record", "digits"]);
    expect(recordingKeymap).toBe(1);
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
