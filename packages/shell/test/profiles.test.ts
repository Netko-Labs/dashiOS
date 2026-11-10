import { expect, test } from "bun:test";
import { PROPERTIES } from "../src/shared/dbus/properties.ts";
import { Variant, variant } from "../src/shared/dbus/variant.ts";
import { applyChange, type Profiles, parseProfiles, powerProfiles, shadowProfiles } from "../src/system/profiles.ts";
import { FakeBus } from "./fake-bus.ts";
import { settle } from "./support/time.ts";

const HADESS = "/net/hadess/PowerProfiles";
const UPOWER = "/org/freedesktop/UPower/PowerProfiles";

const profile = (name: string, driver = "tuned") =>
  new Map<string, unknown>([
    ["Profile", variant("s", name)],
    ["Driver", variant("s", driver)],
  ]);
const tunedProperties = (active: string, names = ["power-saver", "balanced", "performance"]) =>
  new Map<string, unknown>([
    ["ActiveProfile", variant("s", active)],
    [
      "Profiles",
      variant(
        "aa{sv}",
        names.map((name) => profile(name)),
      ),
    ],
    ["PerformanceDegraded", variant("s", "")],
  ]);

/** tuned-ppd as it answers on the bus: only the original name, `net.hadess.PowerProfiles`. */
function tunedPpd(active: string): { bus: FakeBus; state: { active: string } } {
  const state = { active };
  const bus = new FakeBus()
    .on(HADESS, PROPERTIES, "GetAll", ([iface]) => {
      if (iface !== "net.hadess.PowerProfiles") throw new Error("org.freedesktop.DBus.Error.UnknownInterface");
      return [tunedProperties(state.active)];
    })
    .on(HADESS, PROPERTIES, "Set", ([, name, value]) => {
      if (name === "ActiveProfile" && value instanceof Variant && typeof value.value === "string") state.active = value.value;
      return [];
    });
  return { bus, state };
}

const unwrapped = (map: Map<string, unknown>) => new Map([...map].map(([key, value]) => [key, value instanceof Variant ? value.value : value]));

test("the daemon's properties: the active profile and the offered ones, low to high", () => {
  expect(parseProfiles(unwrapped(tunedProperties("balanced", ["performance", "power-saver", "balanced"])))).toEqual({
    available: ["power-saver", "balanced", "performance"],
    active: "balanced",
  });
  // A machine without High Performance (no platform profile driver).
  expect(parseProfiles(unwrapped(tunedProperties("power-saver", ["power-saver", "balanced"])))?.available).toEqual(["power-saver", "balanced"]);
});

test("properties that make no sense are no modes", () => {
  expect(parseProfiles(new Map([["ActiveProfile", "turbo"]]))).toBeNull();
  expect(parseProfiles(unwrapped(tunedProperties("performance", ["power-saver", "balanced"])))).toBeNull();
  expect(
    parseProfiles(
      new Map([
        ["ActiveProfile", "balanced"],
        ["Profiles", "balanced"],
      ]),
    ),
  ).toBeNull();
});

test("a change moves the active mode; a change to a mode the machine lacks is ignored", () => {
  const known: Profiles = { available: ["power-saver", "balanced", "performance"], active: "balanced" };
  expect(applyChange(known, new Map([["ActiveProfile", "performance"]]))?.active).toBe("performance");
  expect(applyChange({ ...known, available: ["power-saver", "balanced"] }, new Map([["ActiveProfile", "performance"]]))?.active).toBe("balanced");
  expect(applyChange(known, new Map([["PerformanceDegraded", "lap-detected"]]))).toEqual(known);
});

test("reads tuned-ppd under the original name when the newer one is absent", async () => {
  const { bus } = tunedPpd("balanced");
  const source = powerProfiles(bus.link());
  expect(await source.read()).toEqual({ available: ["power-saver", "balanced", "performance"], active: "balanced" });
  // It asked the newer name first, then the original.
  expect(bus.callsTo("GetAll").map((call) => call.path)).toEqual([UPOWER, HADESS]);
});

test("setting a mode writes ActiveProfile and reads it back", async () => {
  const { bus, state } = tunedPpd("balanced");
  const source = powerProfiles(bus.link());
  expect(await source.set("performance")).toBe(true);
  expect(state.active).toBe("performance");
  const [set] = bus.callsTo("Set");
  expect(set?.body?.slice(0, 2)).toEqual(["net.hadess.PowerProfiles", "ActiveProfile"]);
});

test("no daemon: no modes, and a mode can't be set", async () => {
  const source = powerProfiles(new FakeBus().link());
  expect(await source.read()).toBeNull();
  expect(await source.set("balanced")).toBe(false);
});

test("the change signal moves the row: `tuned-adm profile` elsewhere reaches the watcher", async () => {
  const { bus } = tunedPpd("balanced");
  const source = powerProfiles(bus.link());
  await source.read();
  const seen: Array<string | undefined> = [];
  source.watch((profiles) => seen.push(profiles?.active));
  await settle();
  bus.emit(HADESS, PROPERTIES, "PropertiesChanged", ["net.hadess.PowerProfiles", new Map([["ActiveProfile", variant("s", "power-saver")]]), []]);
  // Another interface's change, and a repeat of the same value, say nothing.
  bus.emit(HADESS, PROPERTIES, "PropertiesChanged", ["org.example.Other", new Map([["ActiveProfile", variant("s", "performance")]]), []]);
  bus.emit(HADESS, PROPERTIES, "PropertiesChanged", ["net.hadess.PowerProfiles", new Map([["ActiveProfile", variant("s", "power-saver")]]), []]);
  expect(seen).toEqual(["power-saver"]);
});

test("a development run reads the machine's modes but keeps its choice in memory", async () => {
  const { bus, state } = tunedPpd("balanced");
  const source = shadowProfiles(powerProfiles(bus.link()));
  expect(await source.set("power-saver")).toBe(true);
  expect(state.active).toBe("balanced");
  expect((await source.read())?.active).toBe("power-saver");
});
