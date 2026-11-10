import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Monitor } from "../src/display-config/monitors.ts";
import { autoRates, decideRefresh, type RefreshChoice } from "../src/display-config/refresh-policy.ts";
import { graphicsOnBattery, refreshOnBattery } from "../src/settings-app/panes/on-battery.tsx";
import { readSettings, SettingsStore } from "../src/settings-app/store.ts";
import { offered, panel } from "./support/refresh-rate.ts";

const dir = mkdtempSync(join(tmpdir(), "dashi-refresh-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const decide = (monitor: Monitor, plugged: boolean, choice: RefreshChoice = "automatic", held = false) => decideRefresh({ choice, plugged, monitor, held });

test("on battery the panel goes to 60 Hz, plugged in back to its top rate, at the same size", () => {
  const unplugged = decide(panel(120_000), false);
  expect(unplugged).toMatchObject({ offered: true, automatic: true, set: { width: 2880, height: 1800, refreshMhz: 60_000 } });
  expect(unplugged.why).toBe("Automatic: 60 Hz on battery");
  const plugged = decide(panel(60_000), true);
  expect(plugged.set).toEqual({ width: 2880, height: 1800, refreshMhz: 120_000 });
  expect(plugged.why).toBe("Automatic: 120 Hz plugged in");
  // Already there: nothing to set.
  expect(decide(panel(60_000), false).set).toBeNull();
  expect(decide(panel(120_000), true).set).toBeNull();
});

test("a panel with no lower rate at its size gets no Automatic", () => {
  const only60 = panel(60_000, { modes: [offered(2880, 1800, 60_000, true), offered(1920, 1200, 60_000)] });
  expect(autoRates(only60)).toBeNull();
  expect(decide(only60, false)).toEqual({ offered: false, automatic: false, set: null, wanted: null, why: "" });
  // 59.94 and 60 are the same rate, and a 48 Hz mode is too slow to count.
  const near = panel(60_000, { modes: [offered(2880, 1800, 60_000, true), offered(2880, 1800, 59_940), offered(2880, 1800, 48_000)] });
  expect(autoRates(near)).toBeNull();
});

test("on battery: the rate nearest 60 that is not under 59, so 60 over 59.94 and 59.94 over 48", () => {
  const both = panel(120_000, { modes: [offered(2880, 1800, 120_000, true), offered(2880, 1800, 59_940), offered(2880, 1800, 60_000)] });
  expect(autoRates(both)?.battery.refreshMhz).toBe(60_000);
  const ntsc = panel(120_000, { modes: [offered(2880, 1800, 120_000, true), offered(2880, 1800, 59_940), offered(2880, 1800, 48_000)] });
  expect(autoRates(ntsc)?.battery.refreshMhz).toBe(59_940);
  expect(decide(ntsc, false).why).toBe("Automatic: 59.94 Hz on battery");
  // A 90 Hz panel with nothing near 60 still comes down to 90.
  const ninety = panel(120_000, { modes: [offered(2880, 1800, 120_000, true), offered(2880, 1800, 90_000), offered(2880, 1800, 48_000)] });
  expect(autoRates(ninety)?.battery.refreshMhz).toBe(90_000);
});

test("the resolution is kept: a screen at a smaller size moves between that size's rates", () => {
  const small = panel(144_000, { mode: { width: 1920, height: 1200, refreshMhz: 144_000 } });
  expect(decide(small, false).set).toEqual({ width: 1920, height: 1200, refreshMhz: 60_000 });
  expect(decide({ ...small, mode: { width: 1920, height: 1200, refreshMhz: 60_000 } }, true).set).toEqual({ width: 1920, height: 1200, refreshMhz: 144_000 });
});

test("external screens are never changed", () => {
  const dell = panel(120_000, { name: "DP-1", builtIn: false });
  expect(autoRates(dell)).toBeNull();
  expect(decide(dell, false)).toMatchObject({ offered: false, set: null });
});

test("a rate the person picked, or one set another way for the session, wins over Automatic", () => {
  const fixed = decide(panel(120_000), false, "fixed");
  expect(fixed).toMatchObject({ offered: true, automatic: false, set: null });
  expect(fixed.why).toBe("120 Hz, chosen by you");
  const held = decide(panel(120_000), false, "automatic", true);
  expect(held).toMatchObject({ automatic: true, set: null, wanted: { refreshMhz: 60_000 } });
  expect(held.why).toBe("120 Hz for now. Automatic picks again when you plug in");
  // A screen that is off (the lid shut with a monitor attached) is left until it is on.
  expect(decide(panel(120_000, { enabled: false }), false)).toMatchObject({ offered: true, set: null });
});

test("Battery & Power says what each choice does on battery", () => {
  expect(graphicsOnBattery({ choice: "automatic" })).toBe("Built-in graphics on battery, so the card sleeps.");
  expect(graphicsOnBattery({ choice: "hybrid" })).toBe("Hybrid, chosen by you, on battery too.");
  const monitor = panel(120_000);
  const rates = autoRates(monitor);
  expect(refreshOnBattery({ choice: "automatic", rates, decision: decide(monitor, true) })).toBe("60 Hz on battery, 120 Hz plugged in.");
  expect(refreshOnBattery({ choice: "fixed", rates, decision: decide(monitor, false, "fixed") })).toBe("120 Hz, chosen by you, on battery too.");
});

test("settings: a file from before the choice is Automatic; a picked rate is kept as fixed, Automatic as nothing", () => {
  expect(readSettings({ displays: { "eDP-1": { scale: 1.75 } } }).displays["eDP-1"]).toEqual({ scale: 1.75 });
  expect(readSettings({ displays: { "eDP-1": { refresh: "fixed" } } }).displays["eDP-1"]).toEqual({ refresh: "fixed" });
  expect(readSettings({ displays: { "eDP-1": { refresh: "sometimes", scale: 2 } } }).displays["eDP-1"]).toEqual({ scale: 2 });
  const path = join(dir, "settings.json");
  writeFileSync(path, JSON.stringify({ displays: { "eDP-1": { scale: 1.75 } } }));
  const settings = new SettingsStore(path);
  expect(settings.displayRefresh("eDP-1")).toBe("automatic");
  expect(settings.displayRefresh("DP-1")).toBe("automatic");
  settings.setDisplayRefresh("eDP-1", "fixed");
  expect(JSON.parse(readFileSync(path, "utf8")).displays["eDP-1"]).toEqual({ scale: 1.75, refresh: "fixed" });
  expect(settings.displayRefresh("eDP-1")).toBe("fixed");
  settings.setDisplayRefresh("eDP-1", "automatic");
  expect(JSON.parse(readFileSync(path, "utf8")).displays["eDP-1"]).toEqual({ scale: 1.75 });
  expect(() => settings.setDisplayRefresh("eDP-1", "sometimes" as RefreshChoice)).toThrow();
});
