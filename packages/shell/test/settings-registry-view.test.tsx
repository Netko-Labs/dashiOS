import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import type { ReactNode } from "react";
import { type GrantEntry, Grants } from "../src/agents/consent.ts";
import { FlagsStore } from "../src/control-center/flags.ts";
import type { AppGrants } from "../src/privacy/store.ts";
import { AppearancePane } from "../src/settings-app/panes/appearance.tsx";
import { DesktopDockPane } from "../src/settings-app/panes/desktop-dock.tsx";
import { MousePane } from "../src/settings-app/panes/mouse.tsx";
import { PrivacyPane } from "../src/settings-app/panes/privacy.tsx";
import { TrackpadPane } from "../src/settings-app/panes/trackpad.tsx";
import { rowPlace, SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import { PaneStoresContext } from "../src/settings-app/setting.tsx";
import { SettingsStore } from "../src/settings-app/store.ts";

// Panes drawn from the registry, on a stand-in for the Metal host: every row is there, at its address, and its control works.

const dir = mkdtempSync(join(tmpdir(), "dashi-registry-view-"));
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
