import { expect, test } from "bun:test";
import type { CatalogIndex, InstalledApplet, Manifest } from "@dashi/applet";
import { AddOns } from "../src/applet-store/add-ons.ts";
import { getQuestion, storeScope, storeSections } from "../src/applet-store/launcher-store.ts";

const DASHI = "https://raw.githubusercontent.com/Netko-Labs/dashi-applets/index/index.json";
const URL_BASE = "https://github.com/Netko-Labs/dashi-applets/releases/download";

function manifest(id: string, name: string, patch: Partial<Manifest> = {}): Manifest {
  return {
    id,
    name,
    version: "1.0.0",
    dashi: ">=0.4",
    entry: "src/main.tsx",
    summary: `${name} things`,
    author: { name: "Alex Kim" },
    categories: [],
    permissions: [],
    screenshots: [],
    commands: [],
    controls: [],
    preferences: [],
    ...patch,
  };
}

const version = (v: string) => ({
  version: v,
  dashi: ">=0.4",
  url: `${URL_BASE}/${v}/x.dashi-applet`,
  sha256: "0".repeat(64),
  size: 10,
  signature: "s",
  released: "2026-11-15",
});

function index(entries: Array<{ manifest: Manifest; versions: string[]; reviewed?: boolean }>): CatalogIndex {
  return {
    format: 1,
    generated: "2026-11-16T00:00:00Z",
    skipped: [],
    applets: entries.map((each) => ({
      manifest: each.manifest,
      authorKey: "key",
      reviewed: each.reviewed ?? true,
      source: { url: "https://github.com/x/y", commit: "0123456" },
      screenshots: [],
      versions: each.versions.map(version),
      pulled: [],
    })),
  };
}

function installed(m: Manifest, at: string, consent: string[]): InstalledApplet {
  return {
    manifest: { ...m, version: at },
    record: { version: at, sha256: "0", authorKey: "key", source: "catalog", consent },
    dir: `/x/${m.id}`,
  } as InstalledApplet;
}

const clipboardCommands = [{ name: "search", title: "Search Issues", mode: "view" }] as unknown as Manifest["commands"];

function addOns(have: InstalledApplet[], installs: string[] = []) {
  const linear = manifest("dev.linear.app", "Linear", { commands: clipboardCommands, permissions: [{ kind: "network" }] });
  const weather = manifest("dev.dashi.weather", "Weather");
  const asus = manifest("dev.netko.asus-control", "ASUS Control", { permissions: [{ kind: "notifications" }] });
  const catalogs = {
    dashiUrl: DASHI,
    loadAll: async () => [
      {
        source: { name: "Dashi", url: DASHI, key: "k", builtIn: true },
        index: index([
          { manifest: linear, versions: ["1.0.0"] },
          { manifest: { ...weather, version: "1.1.0" }, versions: ["1.1.0"] },
          { manifest: { ...asus, version: "0.3.0", permissions: [{ kind: "notifications" }, { kind: "hardware", scope: "power" }] }, versions: ["0.3.0"] },
        ]),
        stale: false,
        problem: null,
      },
    ],
  };
  const installer = {
    scan: () => ({ applets: have, unreadable: [] }),
    install: async (entry: { manifest: Manifest }) => {
      installs.push(entry.manifest.id);
      return "/x";
    },
  };
  return { store: new AddOns(catalogs, installer, "0.9.0"), linear, weather, asus, installs };
}

test("an update that asks for nothing new installs by itself; one that asks for more waits", async () => {
  const { store, weather, asus, installs } = addOns(
    [
      installed(manifest("dev.dashi.weather", "Weather"), "1.0.0", []),
      installed(manifest("dev.netko.asus-control", "ASUS Control"), "0.1.0", ["notifications"]),
    ],
    [],
  );
  expect(weather.id).toBe("dev.dashi.weather");
  const done = await store.autoUpdate();
  expect(done).toEqual(["dev.dashi.weather"]);
  expect(installs).toEqual(["dev.dashi.weather"]);
  // ASUS Control 0.3.0 asks for hardware.power: it waits for the person.
  expect(installs).not.toContain(asus.id);
});

test("the launcher's Store lists extensions, applets and what is installed, and asks in place before it gets one", async () => {
  const opened: string[] = [];
  const { store, installs } = addOns([installed(manifest("dev.dashi.weather", "Weather"), "1.1.0", [])]);
  await store.refresh();
  const deps = { addOns: store, openStore: (query: string) => opened.push(query) };
  const sections = storeSections(deps, "");
  expect(sections.map((section) => section.title)).toEqual(["Launcher extensions", "Menu bar applets", "Installed", "Apps"]);
  expect(sections[0]?.rows[0]).toMatchObject({ id: "addon:dev.linear.app", title: "Linear", kind: "Get" });
  expect(storeSections(deps, "lin")[0]?.rows.map((row) => row.title)).toEqual(["Linear"]);

  const scope = storeScope(deps);
  const row = sections[0]?.rows[0];
  if (!row) throw new Error("no row");
  const [get] = scope.verbs(row, "");
  expect(get?.id).toBe("get");
  expect(get?.confirm).toContain("Get “Linear”? Adds 1 command to the launcher.");
  expect(get?.confirm).toMatch(/It can: .*network/i);
  // Choosing the row itself never installs: it shows the add-on in the Store.
  expect(row.action).toEqual({ kind: "scope", verb: "show" });
  expect(await scope.run("get", row, "")).toEqual({ notice: { text: "Linear is in", ok: true } });
  expect(installs).toEqual(["dev.linear.app"]);
  expect(await scope.run("find", sections[3]?.rows[0], "obs")).toEqual({ close: true });
  expect(opened).toEqual(["obs"]);
});

test("an add-on Dashi hasn't read says so in its question", async () => {
  const { store, linear } = addOns([]);
  await store.refresh();
  const entry = store.getSnapshot().entries?.find((each) => each.manifest.id === linear.id);
  if (!entry) throw new Error("no entry");
  expect(getQuestion({ ...entry, reviewed: false })).toContain("Nobody at Dashi has read this version’s code.");
});
