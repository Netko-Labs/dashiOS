import { afterEach, expect, test } from "bun:test";
import { type ActionDef, ok, ready } from "../src/actions/types.ts";
import { KEYMAP } from "../src/keymap/keymap.ts";
import type { LauncherHost, LauncherPrefsStore, LauncherWorldStore } from "../src/launcher/host.ts";
import { LauncherKeys } from "../src/launcher/keys.ts";
import type { LauncherWindow } from "../src/launcher/lib/items.ts";
import { aliasIndex, withAlias, withKey } from "../src/launcher/person-keys.ts";
import type { LauncherPrefsSnapshot } from "../src/launcher/prefs.ts";
import type { WorldSnapshot } from "../src/launcher/world.ts";
import { app, mount, unmountLauncher } from "./launcher-harness.tsx";
import { settle } from "./support/time.ts";

// Wave 2 in the panel: the registry and the windows as sources, the action
// list in place (❖K, right-click), controls in the row, aliases and keys,
// and a link's action waiting for Return.

afterEach(unmountLauncher);

function fakeHost(log: string[]): LauncherHost {
  return {
    run: async (action, args) => {
      log.push(`run ${action.address}${args && Object.keys(args).length > 0 ? ` ${JSON.stringify(args)}` : ""}`);
      return { ok: true, text: "Done." };
    },
    reveal: (place) => void log.push(`reveal ${place.pane}/${place.row}`),
    focus: async (window) => void log.push(`focus w${window.id}`),
    newWindow: (entry) => {
      log.push(`new window ${entry.id}`);
      return true;
    },
    bringHere: async (window) => void log.push(`bring w${window.id}`),
    minimize: async (window) => void log.push(`minimize w${window.id}`),
    close: async (window) => void log.push(`close w${window.id}`),
    quit: async (windows) => void log.push(`quit ${windows.map((window) => `w${window.id}`).join(" ")}`),
    showInFiles: (file) => void log.push(`show ${file.path}`),
    trash: async (file) => {
      log.push(`trash ${file.path}`);
      return true;
    },
    pinned: () => false,
    pin: (entry, pin) => void log.push(`${pin ? "pin" : "unpin"} ${entry.id}`),
    keymap: () => KEYMAP,
    describe: (bind) => bind,
  };
}

function wifi(on: { value: boolean }): ActionDef {
  return {
    address: "dashi://settings/network/wi-fi",
    title: "Wi-Fi",
    description: "Home-5G",
    keywords: { en: ["wifi", "wireless"] },
    kind: "toggle",
    properties: {},
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source: "controls",
    place: { pane: "network", row: "wi-fi" },
    state: () => on.value,
    check: () => ready(async () => ok("Done.")),
  };
}

const world = (snapshot: Partial<WorldSnapshot>): LauncherWorldStore => {
  const full: WorldSnapshot = { actions: [], windows: [], serial: 0, ...snapshot };
  return { subscribe: () => () => {}, getSnapshot: () => full };
};

function memoryPrefs(): LauncherPrefsStore & { aliases: Record<string, string>; keys: Record<string, string> } {
  const listeners = new Set<() => void>();
  let snapshot: LauncherPrefsSnapshot = { aliases: new Map(), aliasOf: () => undefined, keyOf: () => undefined };
  const made = {
    aliases: {} as Record<string, string>,
    keys: {} as Record<string, string>,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setAlias(address: string, alias: string | null) {
      made.aliases = withAlias(made.aliases, address, alias);
      const aliases = { ...made.aliases };
      snapshot = { ...snapshot, aliases: aliasIndex(aliases), aliasOf: (target) => Object.keys(aliases).find((name) => aliases[name] === target) };
      for (const listener of listeners) listener();
    },
    setKey(address: string, when: string | null) {
      made.keys = withKey(made.keys, address, when);
      for (const listener of listeners) listener();
    },
  };
  return made;
}

const FILES = { ...app("Files"), id: "dev.dashi.files" };
const TEAS = ["Tea Alpha", "Tea Bravo", "Tea Delta"].map(app);
const FILES_WINDOWS: LauncherWindow[] = [
  {
    id: 3,
    address: "dashi://window/w3",
    title: "Downloads",
    appName: "Files",
    entryId: "dev.dashi.files",
    state: "normal",
    icon: "/i.svg",
    desktop: "Desktop 2",
  },
  { id: 4, address: "dashi://window/w4", title: "Report drafts", appName: "Files", entryId: "dev.dashi.files", state: "minimized", icon: "/i.svg" },
];
const VERBS = [
  "verb:switch",
  "verb:new-window",
  "verb:bring-here",
  "verb:window:4",
  "verb:pin",
  "verb:alias",
  "verb:shortcut",
  "verb:copy-address",
  "verb:quit",
];
const ROWS = [
  ...VERBS,
  "verb:forget",
  "verb:forget-all",
  "verb:run",
  "entry:dev.dashi.files",
  ...TEAS.map((entry) => `entry:${entry.id}`),
  "window:3",
  "window:4",
  "action:dashi://settings/network/wi-fi",
  "alias:keep",
  "shortcut:keep",
  "shortcut:hint",
];

test("an app with windows: Enter switches to its last one, ❖↩ opens a new one, and its windows are rows too", async () => {
  const log: string[] = [];
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [FILES], keys, host: fakeHost(log), world: world({ windows: FILES_WINDOWS }) }, ROWS);
  await launcher.type("files");
  expect(launcher.rows().ids.slice(0, 3)).toEqual(["entry:dev.dashi.files", "window:3", "window:4"]);
  expect(launcher.tree()).toContain("2 windows");
  keys.binding("launcher-secondary");
  await settle();
  await launcher.enter();
  expect(log).toEqual(["new window dev.dashi.files", "focus w3"]);
  expect(launcher.closed.length).toBe(2);
});

test("❖K turns the rows into the app's actions, in place: the chip names it, typing filters, Esc goes back", async () => {
  const keys = new LauncherKeys();
  const copied: string[] = [];
  const launcher = await mount(
    {
      entries: [FILES],
      keys,
      host: fakeHost([]),
      world: world({ windows: FILES_WINDOWS }),
      copy: async (text) => {
        copied.push(text);
        return true;
      },
    },
    ROWS,
  );
  await launcher.type("files");
  keys.binding("launcher-actions");
  await settle();
  expect(launcher.has("launcher:chip")).toBe(true);
  expect(launcher.rows().ids).toEqual([...VERBS, "verb:forget", "verb:forget-all"]);
  await launcher.type("copy");
  expect(launcher.rows().ids).toEqual(["verb:copy-address"]);
  await launcher.enter();
  expect(copied).toEqual(["dashi://app/dev.dashi.files"]);
  // Copying goes back to the results, and says so at the field's end.
  expect(launcher.has("launcher:chip")).toBe(false);
  expect(launcher.has("launcher:notice")).toBe(true);
  keys.binding("launcher-actions");
  await settle();
  await launcher.key("Escape");
  expect(launcher.has("launcher:chip")).toBe(false);
  expect(launcher.closed).toEqual([]);
});

test("right-click opens the same list; a destructive verb asks in place, and ↩ again goes ahead", async () => {
  const log: string[] = [];
  const launcher = await mount({ entries: [FILES], host: fakeHost(log), world: world({ windows: FILES_WINDOWS }) }, ROWS);
  await launcher.type("files");
  await launcher.emit({ type: "contextmenu", nodeId: launcher.node("launcher:row:entry:dev.dashi.files"), x: 1, y: 1 });
  expect(launcher.has("launcher:chip")).toBe(true);
  await launcher.type("quit");
  await launcher.enter();
  expect(log).toEqual([]);
  expect(launcher.tree()).toContain("Quit Files and close its 2 windows?");
  await launcher.enter();
  expect(log).toEqual(["quit w3 w4"]);
});

test("Space flips a setting's switch in the row; Enter opens Settings at that row", async () => {
  const log: string[] = [];
  const launcher = await mount({ entries: TEAS, host: fakeHost(log), world: world({ actions: [wifi({ value: false })] }) }, ROWS);
  await launcher.type("wif");
  expect(launcher.rows().ids[0]).toBe("action:dashi://settings/network/wi-fi");
  expect(launcher.has("launcher:switch:action:dashi://settings/network/wi-fi")).toBe(true);
  await launcher.type("wif ");
  expect(log).toEqual(["run dashi://settings/network/wi-fi"]);
  await launcher.enter();
  expect(log).toEqual(["run dashi://settings/network/wi-fi", "reveal network/wi-fi"]);
});

test("Set alias…: the field takes the alias, Return keeps it, and the alias then finds the app first, with its badge", async () => {
  const keys = new LauncherKeys();
  const prefs = memoryPrefs();
  const launcher = await mount({ entries: [FILES, app("Firefox")], keys, prefs, host: fakeHost([]) }, ROWS);
  await launcher.type("files");
  keys.binding("launcher-alias");
  await settle();
  expect(launcher.tree()).toContain("Alias for Files");
  await launcher.type("fi");
  await launcher.enter();
  expect(prefs.aliases).toEqual({ fi: "dashi://app/dev.dashi.files" });
  await launcher.type("fi");
  expect(launcher.rows().ids[0]).toBe("entry:dev.dashi.files");
  expect(launcher.has("launcher:badge:entry:dev.dashi.files")).toBe(true);
});

test("Set shortcut… records the chord through the keymap, and Return keeps it", async () => {
  const keys = new LauncherKeys();
  const prefs = memoryPrefs();
  const recording: boolean[] = [];
  keys.onRecording = (on) => recording.push(on);
  const launcher = await mount({ entries: [FILES], keys, prefs, host: fakeHost([]) }, ROWS);
  await launcher.type("files");
  keys.binding("launcher-shortcut");
  await settle();
  expect(recording).toEqual([true]);
  expect(launcher.rows().ids).toEqual(["shortcut:hint"]);
  keys.binding("launcher-record", { key: "f", shift: false, ctrl: false, alt: true });
  await settle();
  expect(launcher.rows().ids).toEqual(["shortcut:keep"]);
  await launcher.enter();
  expect(prefs.keys).toEqual({ "super+alt+f": "dashi://app/dev.dashi.files" });
  expect(recording).toEqual([true, false]);
});

test("❖ held shows the digits; ❖2 picks the second row; ⇧↩ opens and stays open", async () => {
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: TEAS, keys }, ROWS);
  await launcher.type("tea");
  keys.digits(true);
  await settle();
  // ❖ is drawn as a glyph, the digit beside it.
  expect(launcher.tree()).toContain('"children":["2"]');
  keys.binding("launcher-pick-2");
  await settle();
  expect(launcher.opened).toEqual(["Tea Bravo"]);
  keys.binding("launcher-keep-open");
  await settle();
  expect(launcher.opened).toEqual(["Tea Bravo", "Tea Alpha"]);
});

test("a link's action is shown filled in, and runs only on Return", async () => {
  const log: string[] = [];
  const volume: ActionDef = { ...wifi({ value: true }), address: "dashi://tool/set-volume", title: "Set the volume", source: "tools", kind: "run" };
  const launcher = await mount({ entries: TEAS, host: fakeHost(log), presented: { action: volume, args: { level: 30 } } }, ROWS);
  expect(launcher.tree()).toContain("Set the volume");
  expect(log).toEqual([]);
  await launcher.enter();
  expect(log).toEqual(['run dashi://tool/set-volume {"level":30}']);
});
