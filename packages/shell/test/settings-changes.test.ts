import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actingAs, actor } from "../src/acting.ts";
import { AppMenuStore } from "../src/app-menus/store.ts";
import { changeLine, describeChanges, parseEntries } from "../src/settings-app/changes/index.ts";
import { publishEditMenu } from "../src/settings-app/edit-menu.ts";
import { settingRow } from "../src/settings-app/registry/index.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/flags.ts";

let root = "";
let store: SettingsStore;
let flags: FlagsStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "dashi-settings-changes-"));
  store = new SettingsStore(join(root, "settings.json"));
  flags = new FlagsStore(null);
  store.changes.attach("flags", {
    read: (field) => flags.getSnapshot()[field as "dark"],
    write: (field, value) => flags.set({ [field]: value === true }),
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const stores = () => ({ settings: store, flags });

test("each change says what, from what, to what, and who: you, or the agent acting", async () => {
  store.patch("appearance", { textSize: 1.3 });
  await actingAs({ agent: "claude", key: "/usr/bin/claude" }, async () => {
    // The agent is still the actor after an await, as a tool call's work is.
    await tick();
    settingRow("appearance/reduce-motion").value?.set(stores(), true);
  });
  expect(actor()).toBeNull();
  const [motion, text] = store.changes.getSnapshot();
  expect(text?.by).toBeNull();
  expect(text?.words).toMatchObject({ name: "Text size", menu: "Text Size", from: "Default", to: "Larger", row: "appearance/text-size" });
  expect(changeLine(text?.words ?? { name: "", to: "" })).toBe("Text size: Larger");
  expect(motion?.by).toEqual({ agent: "claude", key: "/usr/bin/claude" });
  expect(changeLine(motion?.words ?? { name: "", to: "" })).toBe("Reduce motion on");
});

test("Control Center's switches changed through the registry are entries too, and undo through their own store", async () => {
  settingRow("appearance/dark-mode").value?.set(stores(), true);
  const [dark] = store.changes.getSnapshot();
  expect(dark?.words).toMatchObject({ name: "Dark Mode", from: "off", to: "on" });
  expect(store.undo.state.undoName).toBe("Dark Mode");
  await store.undo.undo();
  expect(flags.getSnapshot().dark).toBe(false);
  expect(store.changes.getSnapshot()[0]?.undone).toBe(true);
  await store.undo.redo();
  expect(flags.getSnapshot().dark).toBe(true);
  expect(store.changes.getSnapshot()[0]?.undone).toBe(false);
});

test("the same setting dragged is one entry from where it started; another hand or another setting is a new one", () => {
  store.patch("touchpad", { accelSpeed: 0.1 });
  store.patch("touchpad", { accelSpeed: 0.2 });
  store.patch("touchpad", { accelSpeed: 0.35 });
  expect(store.changes.getSnapshot()).toHaveLength(1);
  expect(store.changes.getSnapshot()[0]?.changes).toEqual([{ key: "touchpad.accelSpeed", from: undefined, to: 0.35 }]);
  actingAs({ agent: "codex" }, () => store.patch("touchpad", { accelSpeed: 0.5 }));
  store.patch("touchpad", { tap: true });
  expect(store.changes.getSnapshot()).toHaveLength(3);
});

test("an older change is undone on its own while nothing changed that setting since; ❖Z then puts it back", async () => {
  store.patch("clock", { showDate: false });
  store.patch("appearance", { reduceMotion: true });
  const [, date] = store.changes.getSnapshot();
  if (!date) throw new Error("no entry");
  expect(store.changes.canUndo(date)).toBe(true);
  expect(await store.changes.undoEntry(date.id)).toBe(true);
  expect(store.getSnapshot().data.clock.showDate).toBeUndefined();
  expect(store.getSnapshot().data.appearance.reduceMotion).toBe(true);
  // Undoing it is a step of its own: ❖Z takes the undo back.
  await store.undo.undo();
  expect(store.getSnapshot().data.clock.showDate).toBe(false);

  // Changed again since: that newer entry is the one to undo.
  await tick(1600);
  store.patch("clock", { showDate: true });
  expect(store.changes.canUndo(date)).toBe(false);
  expect(await store.changes.undoEntry(date.id)).toBe(false);
  // Edited by hand to something else since: nothing to undo either.
  const [newest] = store.changes.getSnapshot();
  if (!newest) throw new Error("no entry");
  expect(store.changes.canUndo(newest)).toBe(true);
  writeFileSync(store.path, JSON.stringify({ clock: { showDate: false } }));
  store.reload();
  expect(store.changes.canUndo(newest)).toBe(false);
});

test("the newest change's Undo is Edit › Undo's step", async () => {
  store.patch("mouse", { naturalScroll: true });
  const [entry] = store.changes.getSnapshot();
  if (!entry) throw new Error("no entry");
  expect(await store.changes.undoEntry(entry.id)).toBe(true);
  expect(store.undo.state.canUndo).toBe(false);
  expect(store.undo.state.redoName).toBe("Natural Scrolling");
});

test("the entries are kept in their file, and a file that isn't one is read as none", async () => {
  const kept = join(root, "state", "settings-changes.json");
  const first = new SettingsStore(join(root, "settings.json"), kept);
  actingAs({ agent: "dashi-vm-agent", key: "ssh:dashi-vm-agent" }, () => first.patch("idle", { blankAfterSeconds: 600 }));
  await first.changes.flush();
  await tick(450);
  expect(existsSync(kept)).toBe(true);
  expect(readFileSync(kept, "utf8")).not.toContain("undefined");
  const again = new SettingsStore(join(root, "settings.json"), kept);
  const [entry] = again.changes.getSnapshot();
  expect(entry?.by).toEqual({ agent: "dashi-vm-agent", key: "ssh:dashi-vm-agent" });
  expect(entry?.words).toMatchObject({ name: "Turn display off after", from: "5 minutes", to: "10 minutes" });
  // After a restart it still undoes (not through ❖Z: that is this session's).
  if (!entry) throw new Error("no entry");
  expect(await again.changes.undoEntry(entry.id)).toBe(true);
  expect(again.getSnapshot().data.idle.blankAfterSeconds).toBeUndefined();

  expect(parseEntries({ version: 1, entries: [{ id: 1, at: 1, by: null, changes: [{ key: "../etc" }], words: {} }, "x"] })).toEqual([]);
  expect(parseEntries(null)).toEqual([]);
});

test("words for what a pane keeps itself, and none for what only programs change", () => {
  expect(describeChanges([{ key: "power.chargeLimit", from: undefined, to: 80 }])).toMatchObject({ name: "Charge limit", from: "100%", to: "80%" });
  // A locale reads as its language, not as glibc writes it ("was En_US.UTF 8").
  expect(describeChanges([{ key: "region.formats", from: "en_US.UTF-8", to: undefined }])).toMatchObject({
    name: "Formats",
    from: "English (United States)",
    to: "the language's",
  });
  expect(describeChanges([{ key: "region.formats", from: undefined, to: "de_DE.UTF-8" }])?.to).toBe("German (Germany)");
  expect(describeChanges([{ key: "spaces.count", from: 1, to: 2 }])).toBeNull();
  expect(describeChanges([{ key: "launcher.aliases", from: undefined, to: {} }])).toBeNull();
});

test("Edit › Find, ❖F, is in Settings' Edit menu and asks for the search", async () => {
  const menus = new AppMenuStore();
  let finds = 0;
  const menu = publishEditMenu(
    menus,
    store.undo,
    async () => 4545,
    async () => {},
    () => void finds++,
  );
  await tick();
  expect(menus.shortcut([4545], "❖F")).toBe(true);
  await tick();
  expect(finds).toBe(1);
  menu.stop();
});
