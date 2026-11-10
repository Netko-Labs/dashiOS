import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { averageUse, ownerOf, significant, usageBetween } from "../src/battery/apps.ts";
import { chargingBand, drawChart, drawMax, levelChart } from "../src/battery/chart.ts";
import { HistoryFile } from "../src/battery/file.ts";
import {
  awakeSeconds,
  currentDischarge,
  drawWatts,
  formatSpan,
  parseSample,
  prune,
  type Sample,
  series,
  sinceUnplugged,
  typicalWatts,
} from "../src/battery/history.ts";
import { insights } from "../src/battery/insights.ts";
import { BatteryMonitor } from "../src/battery/monitor.ts";
import type { ProcessSample } from "../src/shared/processes/read.ts";
import type { PowerSupply } from "../src/system/battery.ts";
import { flush } from "./support/time.ts";

const NOW = 1_800_000_000;
const minute = (minutesAgo: number, fields: Partial<Sample> = {}): Sample => ({
  t: NOW - minutesAgo * 60,
  percent: 50,
  state: "discharging",
  watts: 8,
  ...fields,
});
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

test("the draw: power when the battery reports it, else current × voltage, else unknown", () => {
  expect(drawWatts([supply({ powerNow: "9400000" })])).toBe(9.4);
  expect(drawWatts([supply({ currentNow: "-800000", voltageNow: "12000000" })])).toBe(9.6);
  expect(drawWatts([supply({})])).toBeNull();
  expect(drawWatts([{ ...supply({ powerNow: "5000000" }), scope: "Device" }])).toBeNull();
});

test("since unplugged: the discharging run that ends now, its use and rate while awake", () => {
  const samples = [
    minute(200, { state: "charging", percent: 90 }),
    ...Array.from({ length: 61 }, (_, i) => minute(60 - i, { percent: 90 - Math.floor(i / 3) })),
  ];
  expect(sinceUnplugged(samples)).toHaveLength(61);
  const run = currentDischarge(samples);
  expect(run).toMatchObject({ since: NOW - 3600, used: 20, perHour: 20, awake: 3600 });
  expect(currentDischarge([...samples, minute(0, { state: "charging" })])).toBeNull();
});

test("time asleep (a gap over ten minutes) doesn't count as time awake", () => {
  expect(awakeSeconds([minute(120), minute(119), minute(30), minute(29)])).toBe(120);
});

test("the usual draw is the week's median while discharging, once there is an hour of it", () => {
  const hour = Array.from({ length: 60 }, (_, i) => minute(i + 1, { watts: i < 30 ? 6 : 10 }));
  expect(typicalWatts(hour)).toBe(8);
  expect(typicalWatts(hour.slice(0, 59))).toBeNull();
  expect(typicalWatts([...hour, minute(0, { state: "charging", watts: 60 })])).toBe(8);
});

test("prune keeps a week; series buckets the day; stored lines are checked", () => {
  expect(prune([minute(8 * 24 * 60), minute(1)], NOW)).toEqual([minute(1)]);
  const points = series([minute(5), minute(20)], NOW, 3600, 900);
  expect(points.map((point) => point?.t ?? null)).toEqual([null, null, NOW - 20 * 60, NOW - 5 * 60]);
  expect(parseSample(JSON.stringify(minute(1)))).toEqual(minute(1));
  expect(parseSample('{"t":1,"percent":120,"state":"discharging","watts":1}')).toBeNull();
  expect(parseSample('{"t":1,"percent":20,"state":"exploding","watts":1}')).toBeNull();
  expect(parseSample("not json")).toBeNull();
  expect(formatSpan(125 * 60)).toBe("2 h 05 min");
  expect(formatSpan(45 * 60)).toBe("45 min");
});

const proc = (pid: number, ppid: number, name: string, cpuTicks: number, uid = 1000): ProcessSample => ({
  pid,
  ppid,
  name,
  uid,
  state: "S",
  cpuTicks,
  threads: 1,
  starttime: pid * 10,
  memory: 0,
  kernel: false,
  io: null,
  sockets: null,
  command: name,
  app: null,
  wakeups: null,
  gpu: null,
});

test("processor time goes to the app whose window it or an ancestor owns, else to its own name", () => {
  const before = new Map([
    [10, proc(10, 1, "helium", 0)],
    [11, proc(11, 10, "helium-renderer", 0)],
    [20, proc(20, 1, "indexer", 0)],
    [30, proc(30, 1, "root-daemon", 0, 0)],
  ]);
  const after = new Map([
    [10, proc(10, 1, "helium", 300)],
    [11, proc(11, 10, "helium-renderer", 600)],
    [20, proc(20, 1, "indexer", 150)],
    [30, proc(30, 1, "root-daemon", 3000, 0)],
    [40, proc(40, 1, "new", 500)],
  ]);
  const owner = ownerOf(after, [{ pid: 10, key: "helium", name: "Helium" }]);
  const use = usageBetween(before, after, 30, { uid: 1000, hz: 100, owner });
  // 900 ticks over 30 s at 100 Hz: 0.3 of a core; the indexer 0.05; root's daemon and the new process don't count.
  expect(use.sort((a, b) => b.cores - a.cores)).toEqual([
    { key: "helium", name: "Helium", cores: 0.3 },
    { key: "process:indexer", name: "indexer", cores: 0.05 },
  ]);
  const averaged = averageUse([use, [{ key: "helium", name: "Helium", cores: 0.1 }]]);
  expect(averaged[0]).toEqual({ key: "helium", name: "Helium", cores: 0.2 });
  expect(significant(averaged).map((app) => app.name)).toEqual(["Helium"]);
});

test("insights: faster than usual names the heaviest app; warnings come first", () => {
  const week = Array.from({ length: 120 }, (_, i) => minute(200 + i, { watts: 7 }));
  const recent = Array.from({ length: 10 }, (_, i) => minute(10 - i, { watts: 15, percent: 25 }));
  const found = insights({
    now: NOW,
    battery: { percent: 25, state: "discharging", minutesLeft: 90 },
    health: 72,
    watts: 15,
    samples: [...week, ...recent],
    apps: [{ key: "helium", name: "Helium", cores: 0.8 }],
    lowPower: false,
  });
  expect(found.map((insight) => insight.id)).toEqual(["faster", "health", "low-power", "apps", "discharge"]);
  expect(found[0]?.detail).toContain("usually 7.0 W");
  expect(found[0]?.detail).toContain("Helium");
  expect(found[1]?.title).toBe("Battery health is 72%");
});

test("insights: charging says the rate and when it's full; a week kept full gets a tip", () => {
  const week = Array.from({ length: 24 * 60 }, (_, i) => minute(i + 1, { state: "full", percent: 100, watts: 0 }));
  const found = insights({
    now: NOW,
    battery: { percent: 60, state: "charging", minutesLeft: 45 },
    health: 95,
    watts: 40,
    samples: week,
    apps: [],
    lowPower: null,
  });
  expect(found.map((insight) => insight.id)).toEqual(["kept-full", "charging"]);
  expect(found[1]).toMatchObject({ title: "Charging at 40.0 W", detail: "Full in about 45 min." });
});

test("the charts draw the charge, the stretches on power, and the draw; empty days draw nothing", () => {
  const samples = [
    minute(90, { state: "charging", percent: 40 }),
    minute(60, { percent: 80 }),
    minute(45, { percent: 75 }),
    minute(30, { percent: 70, watts: 12 }),
  ];
  const box = { width: 200, height: 80, now: NOW };
  expect(levelChart(samples, box)).toContain("<path");
  expect(chargingBand(samples, box)).toContain("<rect");
  expect(drawChart(samples, box, drawMax(samples))).toContain("<path");
  expect(drawMax(samples)).toBe(15);
  expect(levelChart([], box)).not.toContain("<path");
});

const dir = mkdtempSync(join(tmpdir(), "dashi-battery-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the history file appends, drops what is old or broken, and trims itself", () => {
  const path = join(dir, "history.jsonl");
  const old = Array.from({ length: 40 }, (_, i) => JSON.stringify(minute(9 * 24 * 60 + i))).join("\n");
  writeFileSync(path, `${old}\nnot json\n${JSON.stringify(minute(2))}\n`);
  const file = new HistoryFile(path);
  expect(file.read(NOW)).toEqual([minute(2)]);
  expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  file.append(minute(1));
  expect(file.read(NOW)).toEqual([minute(2), minute(1)]);
});

test("the monitor samples the battery, measures the apps, and publishes insights", async () => {
  const appended: Sample[] = [];
  let ticks = 0;
  let clock = NOW;
  const monitor = new BatteryMonitor({
    supplies: async () => [supply({ capacity: "40", powerNow: "11000000", energyNow: "20000000", energyFull: "50000000" })],
    processes: () => new Map([[10, proc(10, 1, "helium", (ticks += 900))]]),
    windows: async () => [{ pid: 10, key: "helium", name: "Helium" }],
    health: async () => 91,
    lowPower: async () => false,
    file: { read: () => [minute(5)], append: (sample) => appended.push(sample) },
    uid: 1000,
    hz: 100,
    now: () => clock,
  });
  await monitor.start();
  clock += 30;
  // The second look at the apps is a timer's; drive it by hand.
  (monitor as unknown as { look(): void }).look();
  await flush();
  const state = monitor.getSnapshot();
  monitor.stop();
  expect(state.available).toBe(true);
  expect(state.watts).toBe(11);
  expect(appended).toHaveLength(1);
  expect(state.samples).toHaveLength(2);
  expect(state.significant.map((app) => app.name)).toEqual(["Helium"]);
  expect(state.insights.map((insight) => insight.id)).toContain("apps");
});
