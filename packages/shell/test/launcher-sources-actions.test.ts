import { describe, expect, test } from "bun:test";
import { ok, ready } from "../src/actions/types.ts";
import { KEYMAP } from "../src/keymap.ts";
import { aliasRows, aliasToKeep, mayKeep, shortcutRows } from "../src/launcher/editing.ts";
import { launcherIndex } from "../src/launcher/items.ts";
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
import { buildSections, type ListInput, selectable } from "../src/launcher/rows.ts";
import { describeBinding } from "../src/launcher/shell-host.ts";
import { filterVerbs, hintFor, presentedVerbs, spaceFlips, verbsFor } from "../src/launcher/verbs.ts";
import type { LauncherSettings } from "../src/settings-app/store.ts";
import { action, app, darkMode, ICONS, window } from "./support/launcher-fixtures.ts";

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
