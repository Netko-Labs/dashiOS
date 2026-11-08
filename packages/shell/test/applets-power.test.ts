import { expect, test } from "bun:test";
import { type Manifest, parseManifest } from "@dashi/applet";
import type { AppletContext } from "../src/applets/connection.ts";
import { AppletPower, mayChoosePower, powerState } from "../src/applets/power.ts";
import { AppletConnection } from "../src/applets/server.ts";
import { ExtrasStore } from "../src/extras/index.ts";
import type { PowerSection } from "../src/power/modes/settings.ts";
import { ModeStore } from "../src/power/modes/store.ts";
import type { ModeChoice } from "../src/power/modes/types.ts";
import type { ProfileId, ProfileSource } from "../src/system/profiles.ts";

const MANIFEST = {
  id: "dev.netko.asus-control",
  name: "ASUS Control",
  version: "0.2.0",
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "Fans, power and lights for ROG and TUF laptops.",
  author: { name: "Alex Kim" },
  permissions: ["hardware.power", "power.mode"],
};

function manifest(extra: Record<string, unknown> = {}): Manifest {
  const parsed = parseManifest({ ...MANIFEST, ...extra });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** tuned-ppd with its three profiles; sets go through at once. */
function profiles(): ProfileSource {
  const all: ProfileId[] = ["power-saver", "balanced", "performance"];
  let active: ProfileId = "balanced";
  return {
    read: async () => ({ available: all, active }),
    set: async (id) => {
      active = id;
      return true;
    },
    watch: () => () => {},
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 5));

/** Dashi's mode store as the laptop starts it, plugged in, Automatic chosen; and what Settings saved. */
function modes(saved: Array<ModeChoice | undefined> = []) {
  let settings: PowerSection = {};
  const store = new ModeStore({
    profiles: profiles(),
    hardware: null,
    settings: () => settings,
    saveChoice: (choice) => {
      const mode = choice === "automatic" ? undefined : choice;
      saved.push(mode);
      settings = { ...settings, mode };
    },
  });
  store.setProfiles(["power-saver", "balanced", "performance"], "balanced");
  store.setPowerSource({ plugged: true, percent: 70 });
  return { store, saved };
}

function harness(extra: Partial<AppletContext> = {}) {
  const written: Array<Record<string, unknown>> = [];
  const wire = {
    write: (data: Uint8Array) => {
      for (const line of new TextDecoder().decode(data).split("\n")) if (line) written.push(JSON.parse(line));
      return data.byteLength;
    },
    terminate: () => {},
  };
  const conn = new AppletConnection(4242, wire, { extras: new ExtrasStore(), ...extra });
  const send = (message: unknown) => conn.receive(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  const powers = () => written.filter((message) => message.type === "power");
  return { conn, written, send, powers };
}

test("the store's snapshot on the wire: the choice, what Automatic chose now and why", () => {
  const { store } = modes();
  expect(powerState(store.getSnapshot())).toEqual({
    choice: "automatic",
    available: ["low-power", "balanced", "performance"],
    mode: "performance",
    automatic: true,
    why: "Automatic chose High Performance: plugged in",
    failed: false,
  });
  // Before the power source is known: no mode, no reason.
  const early = new ModeStore({ profiles: null, hardware: null, settings: () => ({}), saveChoice: () => {} });
  expect(powerState(early.getSnapshot())).toMatchObject({ choice: "automatic", available: [], mode: null, why: null });
});

test("only a manifest that names power.mode may choose", () => {
  expect(mayChoosePower(manifest())).toBe(true);
  expect(mayChoosePower(manifest({ permissions: ["hardware.power"] }))).toBe(false);
  expect(mayChoosePower(null)).toBe(false);
});

test("a version 4 hello with power.mode hears the mode after the welcome, and on every change", async () => {
  const { store } = modes();
  const power = new AppletPower();
  power.connect(store);
  const { send, written, powers } = harness({ power });
  send({ type: "hello", protocol: 4, manifest: MANIFEST });
  expect(written[0]).toEqual({ type: "welcome", protocol: 4 });
  expect(written[1]).toEqual({
    type: "power",
    choice: "automatic",
    available: ["low-power", "balanced", "performance"],
    mode: "performance",
    automatic: true,
    why: "Automatic chose High Performance: plugged in",
    failed: false,
  });
  // The cable comes out: Automatic picks again, and the applet hears it once.
  store.setPowerSource({ plugged: false, percent: 70 });
  await flush();
  expect(powers().slice(1)).toEqual([expect.objectContaining({ mode: "balanced", why: "Automatic chose Balanced: on battery" })]);
});

test("without power.mode, or on protocol 3, nothing is said and an ask is refused", () => {
  const { store, saved } = modes();
  const power = new AppletPower();
  power.connect(store);
  const without = harness({ power });
  without.send({ type: "hello", protocol: 4, manifest: { ...MANIFEST, permissions: ["hardware.power"] } });
  expect(without.powers()).toEqual([]);
  without.send({ type: "power", choice: "low-power" });
  expect(without.written.at(-1)).toEqual({ type: "error", message: "power: add “power.mode” to applet.json’s permissions" });

  const older = harness({ power });
  older.send({ type: "hello", protocol: 3, manifest: MANIFEST });
  expect(older.written).toEqual([{ type: "welcome", protocol: 3 }]);
  older.send({ type: "power", choice: "low-power" });
  expect(older.written.at(-1)).toMatchObject({ type: "error", message: expect.stringContaining("protocol 4") });
  expect(saved).toEqual([]);
});

test("an installed applet is checked against what it was installed with", () => {
  const { store } = modes();
  const power = new AppletPower();
  power.connect(store);
  // Installed before it asked for the power mode: its own hello can't add it (it isn't let in at all).
  const { send, powers, written } = harness({ power, installed: manifest({ permissions: ["hardware.power"] }) });
  send({ type: "hello", protocol: 4, manifest: MANIFEST });
  expect(powers()).toEqual([]);
  expect(written[0]).toMatchObject({ type: "error", message: expect.stringContaining("as installed") });
});

test("a pick from the applet is a pick in Control Center: saved, Automatic's reason gone, and back", async () => {
  const fromApplet = modes();
  const fromControlCenter = modes();
  const power = new AppletPower();
  power.connect(fromApplet.store);
  const { send, powers } = harness({ power });
  send({ type: "hello", protocol: 4, manifest: MANIFEST });

  send({ type: "power", choice: "low-power" });
  fromControlCenter.store.choose("low-power");
  await flush();
  expect(fromApplet.saved).toEqual(fromControlCenter.saved);
  expect(fromApplet.store.getSnapshot()).toEqual(fromControlCenter.store.getSnapshot());
  expect(powers().at(-1)).toMatchObject({ choice: "low-power", mode: "low-power", automatic: false, why: "Low Power, chosen by you" });

  send({ type: "power", choice: "automatic" });
  await flush();
  expect(fromApplet.saved).toEqual(["low-power", undefined]);
  expect(powers().at(-1)).toMatchObject({ choice: "automatic", mode: "performance", automatic: true });
});

test("a mode the machine lacks, or no modes at all, is refused with the reason", () => {
  const power = new AppletPower();
  const early = harness({ power });
  early.send({ type: "hello", protocol: 4, manifest: MANIFEST });
  // The laptop hasn't started: nothing to say yet, and nothing to choose.
  expect(early.powers()).toEqual([]);
  early.send({ type: "power", choice: "automatic" });
  expect(early.written.at(-1)).toEqual({ type: "error", message: "power: this machine has no power modes" });

  const store = new ModeStore({ profiles: profiles(), hardware: null, settings: () => ({}), saveChoice: () => {} });
  store.setProfiles(["power-saver", "balanced"], "balanced");
  store.setPowerSource({ plugged: true, percent: 70 });
  power.connect(store);
  // Connected later: the applet hears it then.
  expect(early.powers().at(-1)).toMatchObject({ available: ["low-power", "balanced"] });
  early.send({ type: "power", choice: "performance" });
  expect(early.written.at(-1)).toEqual({ type: "error", message: "power: this machine has no High Performance mode" });
});

test("a closed connection stops hearing the mode", () => {
  const { store } = modes();
  const power = new AppletPower();
  power.connect(store);
  const { conn, send, powers } = harness({ power });
  send({ type: "hello", protocol: 4, manifest: MANIFEST });
  conn.closedBySocket();
  store.choose("balanced");
  expect(powers()).toHaveLength(1);
});
