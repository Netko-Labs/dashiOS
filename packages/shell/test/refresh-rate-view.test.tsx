import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { FlagsStore } from "../src/control-center/flags.ts";
import { AutoRefresh } from "../src/display-config/auto-refresh.ts";
import type { ApplyResult } from "../src/display-config/manager.ts";
import { parseMonitors } from "../src/display-config/monitors.ts";
import { DisplaysPane } from "../src/settings-app/panes/displays.tsx";
import { OnBatteryGroup } from "../src/settings-app/panes/on-battery.tsx";
import type { PaneId } from "../src/settings-app/panes.ts";
import { type Arranger, ScreensStore } from "../src/settings-app/screens.ts";
import { PaneStoresContext } from "../src/settings-app/setting.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";
import { Page } from "../src/settings-app/ui.tsx";

// Displays' refresh rate row with Automatic, and Battery & Power's "On battery", on a stand-in for the Metal host.

const dir = mkdtempSync(join(tmpdir(), "dashi-refresh-view-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 20));

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

/** The G14's panel as dashi-comp reports it, at `refreshMhz`. */
const answer = (refreshMhz: number) => ({
  outputs: [
    {
      name: "eDP-1",
      make: "",
      model: "",
      physicalMm: { width: 300, height: 190 },
      scale: 1.75,
      primary: true,
      frame: { x: 0, y: 0, width: 1646, height: 1029 },
      mode: { width: 2880, height: 1800, refreshMhz },
      modes: [
        { width: 2880, height: 1800, refreshMhz: 120_000, preferred: true, current: refreshMhz === 120_000 },
        { width: 2880, height: 1800, refreshMhz: 60_000, current: refreshMhz === 60_000 },
      ],
    },
  ],
});

function machine() {
  let refreshMhz = 120_000;
  const compositor = { request: async (method: string) => (method === "outputs" ? answer(refreshMhz) : {}), on: () => () => {} };
  const setMode = async (_name: string, mode: { refreshMhz?: number }): Promise<ApplyResult> => {
    refreshMhz = mode.refreshMhz ?? refreshMhz;
    return { kept: true, reverted: false };
  };
  const arranger = { setMode, onPending: () => () => {}, pending: false } as unknown as Arranger;
  const displays = { monitors: async () => parseMonitors(answer(refreshMhz)), setMode, onModeChange: () => () => {} };
  return { compositor, arranger, displays, rate: () => refreshMhz };
}

test("Displays offers Automatic first on the built-in screen; a rate picked turns it off, Automatic turns it back on", async () => {
  const at = { settings: new SettingsStore(join(dir, "settings.json")), flags: new FlagsStore(null) };
  const pc = machine();
  const screens = new ScreensStore(pc.compositor, at.settings, pc.arranger);
  await screens.refresh();
  const refresh = new AutoRefresh({ displays: pc.displays, choice: (name) => at.settings.displayRefresh(name), ready: () => true });
  refresh.setPlugged(false);
  await refresh.idle();
  expect(pc.rate()).toBe(60_000);
  await screens.refresh();
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <DisplaysPane screens={screens} settings={at.settings} refresh={refresh} />
    </PaneStoresContext.Provider>,
  );
  expect(view.has("display-refresh:eDP-1:automatic")).toBe(true);
  expect(view.has("display-refresh:eDP-1:120000")).toBe(true);
  await view.press("display-refresh:eDP-1:120000");
  expect(pc.rate()).toBe(120_000);
  expect(at.settings.displayRefresh("eDP-1")).toBe("fixed");
  await view.press("display-refresh:eDP-1:automatic");
  expect(at.settings.displayRefresh("eDP-1")).toBe("automatic");
});

test("Battery & Power's On battery names the refresh rate and goes to its row in Displays", async () => {
  const pc = machine();
  const refresh = new AutoRefresh({ displays: pc.displays, choice: () => "automatic", ready: () => true });
  refresh.setPlugged(true);
  await refresh.idle();
  const shown: Array<[PaneId, string]> = [];
  const view = await mount(
    <Page title="Battery & Power">
      <OnBatteryGroup laptop={null} refresh={refresh} show={(pane, row) => shown.push([pane, row])} />
    </Page>,
  );
  expect(view.has("on-battery")).toBe(true);
  expect(view.has("on-battery-graphics")).toBe(false);
  await view.press("on-battery-refresh");
  expect(shown).toEqual([["displays", "refresh-rate"]]);
  // Without a built-in screen to lower, or a card to switch, there is no group.
  const none = await mount(<OnBatteryGroup laptop={null} refresh={null} show={() => {}} />);
  expect(none.has("on-battery")).toBe(false);
});
