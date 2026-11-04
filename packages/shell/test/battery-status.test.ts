import { expect, test } from "bun:test";
import { batteryEntries, batteryStatus, extraEntries } from "../src/menus/status-menu.ts";
import { formatMinutes, minutesLeft, type PowerSupply, summarizeBattery } from "../src/system/battery.ts";
import { pluggedIn } from "../src/system/charger.ts";

const supply = (fields: Partial<PowerSupply>): PowerSupply => ({
  name: "BAT0",
  type: "Battery",
  status: "Discharging",
  capacity: "50",
  online: null,
  present: "1",
  scope: null,
  ...fields,
});

test("time left from energy: to empty while discharging, to full while charging", () => {
  // 25 Wh of 50 Wh at 10 W: 2.5 h either way.
  const battery = supply({ energyNow: "25000000", energyFull: "50000000", powerNow: "10000000" });
  expect(minutesLeft([battery], false)).toBe(150);
  expect(minutesLeft([{ ...battery, energyNow: "40000000" }], true)).toBe(60);
});

test("time left from charge, when a battery reports no energy; a negative current counts by its size", () => {
  const battery = supply({ chargeNow: "2000000", chargeFull: "4000000", currentNow: "-1000000" });
  expect(minutesLeft([battery], false)).toBe(120);
});

test("no time when the battery doesn't say, or the rate is too small to mean anything", () => {
  expect(minutesLeft([supply({})], false)).toBeNull();
  expect(minutesLeft([supply({ energyNow: "25000000", energyFull: "50000000", powerNow: "0" })], false)).toBeNull();
  expect(minutesLeft([supply({ energyNow: "25000000", energyFull: "50000000", powerNow: "1" })], false)).toBeNull();
});

test("the summary carries the time while charging or discharging, never on hold", () => {
  const discharging = summarizeBattery([supply({ energyNow: "25000000", energyFull: "50000000", powerNow: "10000000" })]);
  expect(discharging).toEqual({ percent: 50, state: "discharging", minutesLeft: 150 });
  const held = summarizeBattery([
    supply({ status: "Not charging", energyNow: "25000000", energyFull: "50000000", powerNow: "0" }),
    { ...supply({}), name: "AC", type: "Mains", online: "1", capacity: null },
  ]);
  expect(held).toEqual({ percent: 50, state: "plugged" });
});

test("the battery menu says the charge, the source, and the time", () => {
  expect(formatMinutes(125)).toBe("2:05");
  expect(batteryStatus({ percent: 40, state: "charging", minutesLeft: 75 })).toBe("1:15 until full");
  expect(batteryStatus({ percent: 40, state: "discharging" })).toBe("Calculating time left…");
  expect(batteryStatus({ percent: 80, state: "plugged" })).toBe("Not charging");
  const entries = batteryEntries({ percent: 40, state: "discharging", minutesLeft: 200 });
  expect(entries.map((entry) => (entry.kind === "item" ? entry.label : "—"))).toEqual([
    "Battery  40%",
    "Power Source: Battery",
    "3:20 remaining",
    "—",
    "Battery Settings…",
  ]);
  expect(entries.at(-1)).toMatchObject({ action: { kind: "battery-settings" } });
});

test("plugging in shows the HUD once; staying on power, unplugging, and the first reading show nothing", () => {
  expect(pluggedIn({ percent: 54, state: "discharging" }, { percent: 54, state: "charging" })).toEqual({ kind: "power", percent: 54, charge: true });
  expect(pluggedIn({ percent: 80, state: "discharging" }, { percent: 80, state: "plugged" })).toEqual({ kind: "power", percent: 80, charge: "plugged" });
  expect(pluggedIn(undefined, { percent: 54, state: "charging" })).toBeNull();
  expect(pluggedIn({ percent: 54, state: "charging" }, { percent: 55, state: "charging" })).toBeNull();
  expect(pluggedIn({ percent: 54, state: "charging" }, { percent: 54, state: "discharging" })).toBeNull();
});

test("an extra's submenu shows as a heading with its rows indented under it", () => {
  const entries = extraEntries("tray:x", [
    { kind: "item", id: "1", label: "Open", enabled: true },
    { kind: "separator" },
    { kind: "item", id: "2", label: "Status", enabled: false, heading: true },
    { kind: "item", id: "3", label: "Online", enabled: true, checked: true, depth: 1 },
  ]);
  expect(entries).toEqual([
    { kind: "item", label: "Open", action: { kind: "extra", key: "tray:x", id: "1" } },
    { kind: "separator" },
    { kind: "item", label: "Status", action: null },
    { kind: "item", label: "    Online", checked: true, action: { kind: "extra", key: "tray:x", id: "3" } },
  ]);
});
