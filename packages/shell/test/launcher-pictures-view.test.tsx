import { afterEach, expect, test } from "bun:test";
import { setTextSizeSource } from "@dashi/ui";
import { KEYMAP } from "../src/keymap.ts";
import type { LauncherHost, LauncherWorldStore } from "../src/launcher/host.ts";
import type { LauncherWindow } from "../src/launcher/items.ts";
import { LauncherKeys } from "../src/launcher/keys.ts";
import type { PictureRect } from "../src/launcher/pictures.ts";
import type { WorldSnapshot } from "../src/launcher/world.ts";
import { app, mount, settle, unmountLauncher } from "./launcher-harness.tsx";

// The windows' live pictures under a row, and the rows at a bigger text size.

afterEach(() => {
  unmountLauncher();
  setTextSizeSource({ subscribe: () => () => {}, textSize: () => 1 });
});

const FILES = { ...app("Files"), id: "dev.dashi.files" };
const WINDOWS: LauncherWindow[] = [
  { id: 3, address: "dashi://window/w3", title: "Downloads", appName: "Files", entryId: "dev.dashi.files", state: "normal", icon: "/i.svg" },
  { id: 4, address: "dashi://window/w4", title: "Report drafts", appName: "Files", entryId: "dev.dashi.files", state: "minimized", icon: "/i.svg" },
];

const world = (snapshot: Partial<WorldSnapshot>): LauncherWorldStore => {
  const full: WorldSnapshot = { actions: [], windows: [], serial: 0, ...snapshot };
  return { subscribe: () => () => {}, getSnapshot: () => full };
};

function focusHost(log: string[]): LauncherHost {
  const nothing = async () => {};
  return {
    run: async () => ({ ok: true, text: "Done." }),
    reveal: () => {},
    focus: async (window) => void log.push(`focus w${window.id}`),
    newWindow: () => true,
    bringHere: nothing,
    minimize: nothing,
    close: nothing,
    quit: nothing,
    showInFiles: () => {},
    trash: async () => true,
    pinned: () => false,
    pin: () => {},
    keymap: () => KEYMAP,
    describe: (bind) => bind,
  };
}

test("→ on an app with windows shows them live under its row; ← → pick, Enter switches, Esc folds", async () => {
  const log: string[] = [];
  const keys = new LauncherKeys();
  const arrows: string[] = [];
  keys.onArrows = (want) => arrows.push(want);
  const sent: PictureRect[][] = [];
  const launcher = await mount({ entries: [FILES], keys, host: focusHost(log), world: world({ windows: WINDOWS }), onPictures: (rects) => sent.push(rects) });
  await launcher.type("files");
  await settle(50);
  expect(arrows.at(-1)).toBe("open");
  expect(launcher.has("launcher:pictures")).toBe(false);

  keys.binding("launcher-right");
  await settle();
  expect(launcher.has("launcher:pictures")).toBe(true);
  expect(arrows.at(-1)).toBe("browse");
  // The row says which window is picked.
  expect(launcher.tree()).toContain("Downloads");
  // Nothing is sent until every frame has been laid out; then once.
  await launcher.emit({ type: "resize", nodeId: launcher.node("launcher:picture:3"), bounds: { x: 54, y: 103, width: 112, height: 70 } });
  expect(sent).toEqual([]);
  await launcher.emit({ type: "resize", nodeId: launcher.node("launcher:picture:4"), bounds: { x: 174, y: 103, width: 112, height: 70 } });
  expect(sent).toEqual([
    [
      { window: 3, x: 57, y: 106, w: 106, h: 64 },
      { window: 4, x: 177, y: 106, w: 106, h: 64 },
    ],
  ]);

  keys.binding("launcher-right");
  await settle();
  expect(launcher.tree()).toContain("Report drafts");
  // The same frames: nothing new to send.
  expect(sent.length).toBe(1);

  await launcher.key("Escape");
  expect(launcher.has("launcher:pictures")).toBe(false);
  expect(sent.at(-1)).toEqual([]);
  expect(launcher.closed.length).toBe(0);

  keys.binding("launcher-right");
  await settle();
  keys.binding("launcher-right");
  await settle();
  await launcher.enter();
  expect(log).toEqual(["focus w4"]);
});

test("← past the first picture folds them, and ↓ to another row does too", async () => {
  const keys = new LauncherKeys();
  const launcher = await mount({ entries: [FILES], keys, host: focusHost([]), world: world({ windows: WINDOWS }) });
  await launcher.type("files");
  keys.binding("launcher-right");
  await settle();
  keys.binding("launcher-left");
  await settle();
  expect(launcher.has("launcher:pictures")).toBe(false);
  keys.binding("launcher-right");
  await settle();
  await launcher.key("ArrowDown");
  expect(launcher.has("launcher:pictures")).toBe(false);
});

test("at the largest text size the rows grow with their type", async () => {
  const launcher = await mount({ entries: [FILES, app("Firefox")] });
  const small = launcher.tree();
  expect(small).toContain('"height":40');
  setTextSizeSource({ subscribe: () => () => {}, textSize: () => 1.5 });
  unmountLauncher();
  const big = await mount({ entries: [FILES, app("Firefox")] });
  await big.type("f");
  expect(big.tree()).toContain('"height":60');
  expect(big.tree()).toContain('"size":26');
});
