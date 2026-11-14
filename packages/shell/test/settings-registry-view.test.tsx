import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type GrantEntry, Grants } from "../src/agents/consent.ts";
import type { AppGrants } from "../src/privacy/store.ts";
import { AppearancePane } from "../src/settings-app/appearance.tsx";
import { describeChanges } from "../src/settings-app/lib/changes/words.ts";
import { DesktopDockPane } from "../src/settings-app/lib/panes/desktop-dock.tsx";
import { MousePane } from "../src/settings-app/lib/panes/mouse.tsx";
import { PrivacyPane } from "../src/settings-app/lib/panes/privacy.tsx";
import { ignoredDetail, TrackpadPane } from "../src/settings-app/lib/panes/trackpad.tsx";
import { PaneStoresContext } from "../src/settings-app/lib/setting.tsx";
import { rowPlace, SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { FlagsStore } from "../src/shared/control-center/flags.ts";
import { PointerDevices } from "../src/system/pointers.ts";
import { settle } from "./support/time.ts";

// Panes drawn from the registry, on a stand-in for the Metal host: every row is there, at its address, and its control works.

const dir = mkdtempSync(join(tmpdir(), "dashi-registry-view-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

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

const stores = () => ({ settings: new SettingsStore(join(dir, `settings-${Math.random()}.json`)), flags: new FlagsStore(null) });

/** The rows of a pane every machine draws (no hardware, no state that hides them). */
const rowsOf = (pane: string, except: readonly string[] = []) =>
  SETTINGS_ROWS.filter((row) => rowPlace(row).pane === pane && !except.includes(row.id)).map((row) => `spot:${rowPlace(row).row}`);

test("every row of a pane is drawn at its address, and a switch from the registry changes settings.json", async () => {
  const at = stores();
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <TrackpadPane settings={at.settings} />
    </PaneStoresContext.Provider>,
  );
  expect(rowsOf("trackpad").filter((spot) => !view.has(spot))).toEqual([]);
  await view.press("trackpad-tap");
  expect(at.settings.getSnapshot().data.touchpad.tap).toBe(true);
  await view.press("trackpad-click:clickfinger");
  expect(at.settings.getSnapshot().data.touchpad.clickMethod).toBe("clickfinger");
});

test("Trackpad's own switch is on until it is turned off, and the pad can be ignored beside a mouse", async () => {
  const at = stores();
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <TrackpadPane settings={at.settings} />
    </PaneStoresContext.Provider>,
  );
  // Off is what the file keeps (`input.touchpad.off`), as the trackpad key writes it; on again is no setting.
  await view.press("trackpad-on");
  expect(at.settings.getSnapshot().data.touchpad.off).toBe(true);
  expect(describeChanges([{ key: "touchpad.off", from: undefined, to: true }])).toMatchObject({ name: "Trackpad on", from: "on", to: "off" });
  await view.press("trackpad-on");
  expect(at.settings.getSnapshot().data.touchpad.off).toBeUndefined();
  await view.press("trackpad-ignore-with-mouse");
  expect(at.settings.getSnapshot().data.touchpad.offWithMouse).toBe(true);
});

test("on a computer dashi-comp says has no trackpad, the switches that turn one off are absent and the pane says why", async () => {
  const at = stores();
  const devices = new PointerDevices();
  devices.set({ touchpad: false, mouse: true });
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <TrackpadPane settings={at.settings} pointers={devices} />
    </PaneStoresContext.Provider>,
  );
  expect(view.has("spot:on")).toBe(false);
  expect(view.has("spot:ignore-with-mouse")).toBe(false);
  expect(view.has("spot:tap-to-click")).toBe(true);
  expect(ignoredDetail(true, { touchpad: true, mouse: true })).toBe("A mouse is connected: the pad is ignored now.");
  expect(ignoredDetail(true, { touchpad: true, mouse: false })).toBeUndefined();
  expect(ignoredDetail(undefined, { touchpad: true, mouse: true })).toBeUndefined();
});

test("Appearance, Mouse, and Desktop & Dock draw all their rows; a choice from the registry writes its value", async () => {
  const at = stores();
  const inStores = (pane: ReactNode) => <PaneStoresContext.Provider value={at}>{pane}</PaneStoresContext.Provider>;
  const mouse = await mount(inStores(<MousePane settings={at.settings} />));
  expect(rowsOf("mouse").filter((spot) => !mouse.has(spot))).toEqual([]);
  const dock = await mount(inStores(<DesktopDockPane />));
  expect(rowsOf("desktop-dock").filter((spot) => !dock.has(spot))).toEqual([]);
  const view = await mount(inStores(<AppearancePane flags={at.flags} settings={at.settings} />));
  expect(rowsOf("appearance").filter((spot) => !view.has(spot))).toEqual([]);
  await view.press("appearance-pointer-size:40");
  expect(at.settings.getSnapshot().data.appearance.pointerSize).toBe(40);
  await dock.press("dock-style:taskbar");
  expect(at.settings.getSnapshot().data.dock.style).toBe("taskbar");
  await view.press("appearance-reduce-motion");
  expect(at.settings.getSnapshot().data.appearance.reduceMotion).toBe(true);
});

test("Privacy & Security lists each app's permissions, takes back only the one revoked, and sends agents to Agents", async () => {
  const at = stores();
  at.settings.patch("screenSharing", { clients: ["/usr/bin/grim", "/usr/bin/wf-recorder"] });
  const grants = new Grants(null);
  grants.set("ssh:alexk-laptop", new Set(["see", "signin"]), 1_760_000_000);
  const revoked: unknown[] = [];
  const shown: string[] = [];
  const snapshot: AppGrants = {
    state: "ready",
    grants: [
      { table: "devices", id: "camera", app: "org.mozilla.firefox", what: "Use the camera", screen: false, lastUsed: null, since: 1_760_000_000 },
      { table: "background", id: "background", app: "org.mozilla.firefox", what: "Run in the background", screen: false, lastUsed: null, since: null },
      {
        table: "screencast",
        id: "token-1",
        app: "com.obsproject.Studio",
        what: "Share the screen again without asking",
        screen: true,
        lastUsed: null,
        since: null,
      },
    ],
  };
  const privacy = {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    revoke: async (grant: unknown) => void revoked.push(grant),
    refresh: async () => {},
  };
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <PrivacyPane
        grants={grants}
        home="/home/alexk"
        settings={at.settings}
        privacy={privacy}
        show={(pane, row) => shown.push(`${pane}/${row}`)}
        installedApp={(id) => (id === "org.mozilla.firefox" ? { name: "Firefox", icon: "/firefox.svg" } : undefined)}
      />
    </PaneStoresContext.Provider>,
  );
  for (const spot of ["spot:agents", "spot:apps", "spot:screen-sharing"]) expect(view.has(spot)).toBe(true);
  expect(view.has("privacy-agents")).toBe(true);
  expect(view.has("privacy-app-grant:org.mozilla.firefox:devices/camera")).toBe(true);
  expect(view.has("privacy-share-grant:com.obsproject.Studio:screencast/token-1")).toBe(true);

  // Each agent's permissions are in Agents, with what it did: one place to take them back.
  await view.press("privacy-agents-open");
  expect(shown).toEqual(["agents/permissions"]);
  expect(grants.entries().map((entry: GrantEntry) => entry.scopes)).toEqual([["see", "signin"]]);

  await view.press("privacy-app-revoke:org.mozilla.firefox:devices/camera");
  expect(revoked).toEqual([snapshot.grants[0]]);

  await view.press("privacy-screen-client-remove:/usr/bin/grim");
  expect(at.settings.getSnapshot().data.screenSharing.clients).toEqual(["/usr/bin/wf-recorder"]);
});

test("with nothing given, each section says so", async () => {
  const at = stores();
  const view = await mount(
    <PaneStoresContext.Provider value={at}>
      <PrivacyPane grants={new Grants(null)} home="/home/alexk" settings={at.settings} show={() => {}} />
    </PaneStoresContext.Provider>,
  );
  for (const none of ["privacy-agents", "privacy-apps-none", "privacy-screen-none"]) expect(view.has(none)).toBe(true);
});
