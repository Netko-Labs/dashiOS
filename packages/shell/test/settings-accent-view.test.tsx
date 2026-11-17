import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { AppearancePane } from "../src/settings-app/appearance.tsx";
import { PaneStoresContext } from "../src/settings-app/lib/setting.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/flags.ts";
import { settle } from "./support/time.ts";

// Settings › Appearance › Accent colour on a stand-in for the Metal host: a swatch writes the choice,
// Custom… opens the picker and Use keeps its colour, and the guard's line shows when a pick moved.

const dir = mkdtempSync(join(tmpdir(), "dashi-accent-view-"));
// The picker's pictures are drawn into the cache: this test's own.
const cacheBefore = process.env.XDG_CACHE_HOME;
process.env.XDG_CACHE_HOME = join(dir, "cache");
afterAll(() => {
  if (cacheBefore === undefined) delete process.env.XDG_CACHE_HOME;
  else process.env.XDG_CACHE_HOME = cacheBefore;
  rmSync(dir, { recursive: true, force: true });
});

async function mount(tree: ReactNode) {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root: NativeRoot = render(tree, transport);
  await settle();
  const has = (testID: string): boolean => root.nodeId(testID) !== null && root.nodeId(testID) !== undefined;
  return {
    has,
    press: async (testID: string): Promise<void> => {
      const nodeId = root.nodeId(testID);
      if (!nodeId) throw new Error(`no node ${testID}`);
      for (const listener of listeners) listener({ type: "press", nodeId });
      await settle();
    },
  };
}

function pane(accent?: string) {
  const at = { settings: new SettingsStore(join(dir, `settings-${Math.random()}.json`)), flags: new FlagsStore(null) };
  if (accent) at.flags.set({ accent });
  const tree = (
    <PaneStoresContext.Provider value={at}>
      <AppearancePane flags={at.flags} settings={at.settings} />
    </PaneStoresContext.Provider>
  );
  return { at, tree };
}

test("a swatch writes the accent; Kombu is no setting", async () => {
  const { at, tree } = pane();
  const view = await mount(tree);
  expect(view.has("accent-swatches")).toBe(true);
  expect(view.has("accent-preview")).toBe(true);
  await view.press("accent-momo");
  expect(at.settings.getSnapshot().data.appearance.accent).toEqual({ preset: "momo" });
  await view.press("accent-wallpaper");
  expect(at.settings.getSnapshot().data.appearance.accent).toEqual({ wallpaper: true });
  await view.press("accent-kombu");
  expect(at.settings.getSnapshot().data.appearance.accent).toBeUndefined();
});

test("Custom… opens the picker on the accent in use, and Use keeps it", async () => {
  const { at, tree } = pane("#E0508F");
  const view = await mount(tree);
  expect(view.has("accent-picker")).toBe(false);
  await view.press("accent-custom");
  expect(view.has("accent-picker")).toBe(true);
  expect(view.has("accent-hex")).toBe(true);
  await view.press("accent-use");
  expect(view.has("accent-picker")).toBe(false);
  expect(at.settings.getSnapshot().data.appearance.accent).toEqual({ custom: "#E0508F" });
});

test("Cancel leaves the accent as it was", async () => {
  const { at, tree } = pane();
  const view = await mount(tree);
  await view.press("accent-custom");
  await view.press("accent-cancel");
  expect(view.has("accent-picker")).toBe(false);
  expect(at.settings.getSnapshot().data.appearance.accent).toBeUndefined();
});

test("the guard's line shows only when a pick was moved", async () => {
  expect((await mount(pane("#F26B1D").tree)).has("accent-guard")).toBe(true);
  expect((await mount(pane("#036DB0").tree)).has("accent-guard")).toBe(false);
});
