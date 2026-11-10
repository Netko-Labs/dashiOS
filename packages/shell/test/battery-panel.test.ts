/**
 * The battery panel's numbers (battery/panel-numbers.ts): the status line,
 * the time to the charge limit, rows of watts that add up to the total in
 * tenths, rows left out when a figure isn't known (never made up), the
 * adapter from its power_supply entry, and the 24-hour line (chart.ts).
 */

import { expect, test } from "bun:test";
import { chargeLine } from "../src/battery/chart.ts";
import type { Sample } from "../src/battery/history.ts";
import type { AppUse } from "../src/battery/lib/apps.ts";
import { adapterOf, batteryTime, formatWatts, idleFloor, minutesToLimit, statusLine, wattRows } from "../src/battery/panel-numbers.ts";
import type { PowerSupply } from "../src/system/battery.ts";

const app = (name: string, cores: number): AppUse => ({ key: name.toLowerCase(), name, cores });

/** An hour and more of draws on battery, the lowest tenth 6.4 W. */
const week: Sample[] = Array.from({ length: 100 }, (_, at) => ({ t: 1_000 + at * 60, percent: 90, state: "discharging", watts: 6 + at * 0.04 }));

const sum = (rows: ReturnType<typeof wattRows>, kind: "app" | "other") =>
  Math.round(rows.filter((row) => row.kind === kind || (kind === "other" && row.kind === "app")).reduce((total, row) => total + row.watts * 10, 0));

test("the time to the limit is the time to full at the same rate, over what is left to the limit", () => {
  expect(minutesToLimit({ percent: 62, state: "charging", minutesLeft: 100 }, 80)).toBe(47);
  expect(minutesToLimit({ percent: 62, state: "charging", minutesLeft: 100 }, null)).toBe(100);
  expect(minutesToLimit({ percent: 85, state: "charging", minutesLeft: 30 }, 80)).toBeNull();
  expect(minutesToLimit({ percent: 62, state: "charging" }, 80)).toBeNull();
  expect(minutesToLimit({ percent: 62, state: "discharging", minutesLeft: 100 }, 80)).toBeNull();
});

test("the row's time and the panel's status line say what the battery is doing", () => {
  expect(batteryTime({ percent: 84, state: "discharging", minutesLeft: 310 }, 80)).toBe("5 h 10 min");
  expect(batteryTime({ percent: 76, state: "charging", minutesLeft: 70 }, 80)).toBe("12 min to 80%");
  expect(batteryTime({ percent: 76, state: "charging", minutesLeft: 70 }, null)).toBe("1 h 10 min to full");
  expect(batteryTime({ percent: 80, state: "plugged" }, 80)).toBeNull();
  expect(statusLine({ percent: 84, state: "discharging", minutesLeft: 310 }, 80)).toBe("On battery · 5 h 10 min left");
  expect(statusLine({ percent: 84, state: "discharging" }, 80)).toBe("On battery");
  expect(statusLine({ percent: 62, state: "charging", minutesLeft: 100 }, 80)).toBe("Charging · 47 min to 80%");
  expect(statusLine({ percent: 80, state: "plugged" }, 80)).toBe("Held at the 80% limit");
  expect(statusLine({ percent: 50, state: "plugged" }, 80)).toBe("Not charging");
  expect(statusLine({ percent: 100, state: "full" }, null)).toBe("Fully charged");
});

test("on battery: the heaviest apps, then everything else, then the total, adding up exactly", () => {
  const apps = [app("Helium", 0.6), app("Claude Code", 0.34), app("Spotify", 0.06)];
  const rows = wattRows({
    battery: { percent: 84, state: "discharging", minutesLeft: 310 },
    watts: 11.8,
    floor: 5.4,
    apps,
    significant: apps.slice(0, 2),
    adapter: { rating: null, input: null },
  });
  expect(rows.map((row) => `${row.label} ${formatWatts(row.watts)}`)).toEqual([
    "Helium 3.8 W",
    "Claude Code 2.1 W",
    "Screen and everything else 5.9 W",
    "Total 11.8 W",
  ]);
  expect(sum(rows, "other")).toBe(118);
  expect(rows[0]?.app).toEqual({ key: "helium", name: "Helium" });
});

test("the sum holds for awkward numbers: the parts never pass the total", () => {
  for (const watts of [0.3, 7.77, 13.05, 42.99]) {
    const apps = [app("A", 0.333), app("B", 0.333), app("C", 0.334)];
    const rows = wattRows({
      battery: { percent: 50, state: "discharging" },
      watts,
      floor: 0.1,
      apps,
      significant: apps,
      adapter: { rating: null, input: null },
    });
    expect(sum(rows, "other")).toBe(Math.round(watts * 10));
    expect(rows.every((row) => row.watts >= 0)).toBe(true);
  }
});

test("what isn't known is left out: no draw, no rows; no floor or no heavy app, the total alone", () => {
  const battery = { percent: 84, state: "discharging" as const };
  const none = { rating: null, input: null };
  expect(wattRows({ battery, watts: null, floor: 5, apps: [app("A", 1)], significant: [app("A", 1)], adapter: none })).toEqual([]);
  expect(wattRows({ battery, watts: 9, floor: null, apps: [app("A", 1)], significant: [app("A", 1)], adapter: none }).map((row) => row.label)).toEqual([
    "Total",
  ]);
  expect(wattRows({ battery, watts: 9, floor: 5, apps: [app("A", 0.1)], significant: [], adapter: none }).map((row) => row.label)).toEqual(["Total"]);
});

test("charging: into the battery always; running the laptop and the adapter only when the adapter says its draw", () => {
  const battery = { percent: 62, state: "charging" as const, minutesLeft: 100 };
  expect(
    wattRows({ battery, watts: 16, floor: null, apps: [], significant: [], adapter: { rating: 65, input: null } }).map(
      (row) => `${row.label} ${formatWatts(row.watts)}`,
    ),
  ).toEqual(["Into the battery 16 W"]);
  const rows = wattRows({ battery, watts: 16, floor: null, apps: [], significant: [], adapter: { rating: 65, input: 25 } });
  expect(rows.map((row) => `${row.label} ${formatWatts(row.watts)}`)).toEqual([
    "Into the battery 16 W",
    "Running the laptop 9 W",
    "From the 65 W adapter 25 W",
  ]);
  expect(wattRows({ battery, watts: null, floor: null, apps: [], significant: [], adapter: { rating: null, input: null } })).toEqual([]);
  expect(
    wattRows({ battery: { percent: 80, state: "plugged" }, watts: 0, floor: null, apps: [], significant: [], adapter: { rating: null, input: 12.5 } }).map(
      (row) => row.label,
    ),
  ).toEqual(["From the adapter"]);
});

test("the floor is the lowest tenth of the week's draws on battery, with an hour of them at least", () => {
  expect(idleFloor(week)).toBeCloseTo(6.4);
  expect(idleFloor(week.slice(0, 30))).toBeNull();
  expect(idleFloor(week.map((sample) => ({ ...sample, state: "charging" as const })))).toBeNull();
});

test("the adapter's rating and draw come from its power_supply entry, when it reports them", () => {
  const supply = (fields: Partial<PowerSupply>): PowerSupply => ({
    name: "x",
    type: null,
    status: null,
    capacity: null,
    online: null,
    present: null,
    scope: null,
    ...fields,
  });
  expect(adapterOf([supply({ type: "Mains", online: "1" })])).toEqual({ rating: null, input: null });
  expect(
    adapterOf([supply({ type: "USB", online: "1", voltageMax: "20000000", currentMax: "3250000", voltageNow: "20000000", currentNow: "1250000" })]),
  ).toEqual({ rating: 65, input: 25 });
  expect(adapterOf([supply({ type: "USB", online: "0", voltageMax: "20000000", currentMax: "3250000" })])).toEqual({ rating: null, input: null });
  expect(adapterOf([supply({ type: "USB", online: "1", scope: "Device", powerNow: "5000000" })])).toEqual({ rating: null, input: null });
});

test("the 24-hour line is drawn on 0–100% with the limit dashed; without a limit, no dashes", () => {
  const now = 100_000;
  const samples: Sample[] = [
    { t: now - 3600 * 3, percent: 90, state: "discharging", watts: 8 },
    { t: now - 3600 * 2, percent: 70, state: "discharging", watts: 8 },
    { t: now - 60, percent: 80, state: "charging", watts: 16 },
  ];
  const svg = chargeLine(samples, { width: 252, height: 46, now }, 80);
  expect(svg).toContain('stroke-dasharray="2 3"');
  expect(svg).toContain('y1="9.2"');
  expect(svg).toContain("<circle");
  expect(chargeLine(samples, { width: 252, height: 46, now }, null)).not.toContain("stroke-dasharray");
});
