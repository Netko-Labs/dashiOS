import { expect, test } from "bun:test";
import { waitingCount } from "../src/agents/presence.ts";
import { type Monitor, nativeSize } from "../src/display-config/monitors.ts";
import { slidersShape, withSliders } from "../src/settings-app/control-center.tsx";
import { timePills } from "../src/settings-app/lib/controls.ts";
import { FOUND_MOST, findSettings } from "../src/settings-app/lib/find.ts";
import {
  appletOffers,
  aspectLabel,
  batteryHero,
  chargeScale,
  chosenMonitor,
  displayHero,
  MINIATURE,
  miniatureFrame,
  miniatureHeight,
  scaleOffer,
} from "../src/settings-app/lib/heroes.ts";
import { describeSchedule } from "../src/settings-app/lib/night.ts";
import { onBatteryLine } from "../src/settings-app/lib/panes/on-battery.tsx";
import { trackingWords } from "../src/settings-app/lib/panes/speed-row.tsx";
import { rowName, rowPlace, SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import { PANES, paneGroups, SIDEBAR_PANES } from "../src/shared/settings/panes.ts";

// The redesigned Settings' pure parts: search and where it lands, the heroes' figures, and every row still reachable.

test("search: a pane's name first, then a row whose name starts with the words, then one that holds them", () => {
  const found = findSettings("night");
  expect(found[0]).toMatchObject({ id: "displays/night-shift", pane: "displays", row: "night-shift", label: "Night Shift" });
  // A pane by its name comes before the rows found by its other words.
  expect(findSettings("displays")[0]).toMatchObject({ id: "displays", pane: "displays" });
  expect(findSettings("displays")[0]?.row).toBeUndefined();
  // A word that only starts a keyword still finds the row, after the ones named so; the charge limit is one setting, found once.
  const charge = findSettings("charge").map((each) => each.id);
  expect(charge).toContain("battery/stop-charging");
  expect(charge).not.toContain("battery/charge-limit");
});

test("search: every typed word must start a word, and the old pane names still find the renamed panes", () => {
  expect(findSettings("wi fi")[0]).toMatchObject({ pane: "network", label: "Wi-Fi" });
  expect(findSettings("network")[0]).toMatchObject({ pane: "network" });
  expect(findSettings("security")[0]).toMatchObject({ pane: "privacy", label: "Privacy" });
  expect(findSettings("accounts")[0]).toMatchObject({ pane: "users", label: "Users" });
  expect(findSettings("ight")).toEqual([]);
  expect(findSettings("   ")).toEqual([]);
});

test("search: the jump target is the row's pane and its address there, and the label is how it reads away from its pane", () => {
  const brightness = findSettings("brightness").find((each) => each.id === "displays/brightness");
  expect(brightness).toMatchObject({ pane: "displays", row: "brightness", label: "Display brightness" });
  const sliders = findSettings("sliders").find((each) => each.id === "control-center/sliders");
  expect(sliders).toMatchObject({ pane: "control-center", row: "sliders" });
  // The glyph is the row's own, as its knob draws it, and its pane is named beside it.
  expect(sliders?.glyph).toBe(SETTINGS_ROWS.find((row) => row.id === "control-center/sliders")?.glyph);
  expect(sliders?.where).toBe("Control Center");
  // A row with no glyph of its own carries its pane's.
  const kernel = findSettings("kernel").find((each) => each.id === "about/kernel");
  expect(kernel?.glyph).toBe(PANES.find((pane) => pane.id === "about")?.glyph);
});

test("search: at most FOUND_MOST, and a pane the machine doesn't list is left out with its rows", () => {
  expect(findSettings("a").length).toBeLessThanOrEqual(FOUND_MOST);
  const noGraphics = findSettings("graphics", (pane) => pane.id !== "graphics");
  expect(noGraphics.some((each) => each.pane === "graphics")).toBe(false);
});

test("every registry row is reachable: its pane is in the sidebar, and searching its own name finds it with a jump target", () => {
  const sidebar = new Set(paneGroups().flatMap((group) => group.panes.map((pane) => pane.id as string)));
  expect(SIDEBAR_PANES.length).toBe(PANES.length);
  const lost: string[] = [];
  for (const row of SETTINGS_ROWS) {
    const place = rowPlace(row);
    if (!sidebar.has(place.pane)) lost.push(`${row.id}: no pane`);
    const found = findSettings(rowName(row)).concat(findSettings(row.title));
    // A part of a setting (the charge limit's slider) may be found as its setting, which lands on the same row.
    const hit = found.find((each) => each.id === row.id) ?? found.find((each) => each.id === row.partOf);
    const target = hit?.id === row.id ? place : rowPlace({ id: (row.partOf ?? row.id) as typeof row.id });
    // A pane's own switch named as the pane ("Bluetooth") is found as the pane, which opens on it.
    const asPane = found.some((each) => each.id === place.pane && each.label === rowName(row));
    if (!hit && !asPane) lost.push(`${row.id}: not found by "${rowName(row)}"`);
    else if (hit && (hit.pane !== target.pane || hit.row !== target.row)) lost.push(`${row.id}: lands on ${hit.pane}/${hit.row}`);
  }
  expect(lost).toEqual([]);
});

test("the battery hero says only what the battery reports", () => {
  expect(batteryHero(null, 11.8, 80)).toBeNull();
  // On battery with its time and draw.
  expect(batteryHero({ percent: 84, state: "discharging", minutesLeft: 310 }, 11.8, 80)).toEqual({
    percent: 84,
    status: "On battery · 5 h 10 min left · 11.8 W",
    limit: 80,
  });
  // No time, no watts: both left out, never made up.
  expect(batteryHero({ percent: 84, state: "discharging" }, null, null)).toEqual({ percent: 84, status: "On battery", limit: null });
  // A zero draw is no reading; a limit of 100 draws no tick.
  expect(batteryHero({ percent: 100, state: "full" }, 0, 100)).toEqual({ percent: 100, status: "Fully charged", limit: null });
  // Charging: the time to the limit, and what goes in.
  expect(batteryHero({ percent: 62, state: "charging", minutesLeft: 90 }, 16, 80)?.status).toBe("Charging · 43 min to 80% · 16 W");
  // Plugged in at the limit: no watts are flowing, so none are said.
  expect(batteryHero({ percent: 80, state: "plugged" }, 3, 80)?.status).toBe("Held at the 80% limit");
  expect(chargeScale(80)).toBe("0–100% · limit 80% dashed");
  expect(chargeScale(null)).toBe("0–100%");
});

const monitor = (over: Partial<Monitor>): Monitor => ({
  name: "eDP-1",
  make: "",
  model: "",
  serial: "",
  builtIn: true,
  enabled: true,
  lit: true,
  primary: true,
  widthMm: 300,
  heightMm: 190,
  scale: 1.75,
  frame: { x: 0, y: 0, width: 1646, height: 1029 },
  mode: { width: 2880, height: 1800, refreshMhz: 120_000 },
  modes: [],
  rotation: 0,
  flipped: false,
  vrr: { supported: false, active: false, mode: "off" },
  ...over,
});

test("the display hero says only what no row says, each fact once", () => {
  const hero = displayHero(monitor({}), { width: 220, height: 138 });
  expect(hero.name).toBe("Built-in");
  // The title names a lone display, Resolution says its size, Scale what it looks like: the hero keeps its shape and its rate.
  expect(hero.caption).toBe("16:10 · 120 Hz");
  expect(hero.label).toBe("Built-in · 2880 × 1800 · 16:10");
  expect(hero.shape).toEqual({ width: 220, height: 138 });
  // With a Refresh rate row, the rate is that row's to say; with several displays, each picture carries its name.
  expect(displayHero(monitor({}), { width: 220, height: 138 }, { rateRow: true }).caption).toBe("16:10");
  expect(displayHero(monitor({}), { width: 170, height: 106 }, { several: true, rateRow: true }).caption).toBe("Built-in · 16:10");
  // Turned on its side: taller than wide, the box's height first.
  const portrait = displayHero(monitor({ rotation: 90 }), { width: 220, height: 138 });
  expect(portrait.label).toBe("Built-in · 1800 × 2880 · 16:10");
  expect(portrait.shape.height).toBe(138);
  expect(portrait.shape.width).toBeLessThan(portrait.shape.height);
  // An odd shape has no name, and is left out; with nothing else to say, the name stands.
  expect(displayHero(monitor({ mode: { width: 1366, height: 768, refreshMhz: 60_000 } }), { width: 220, height: 138 }, { rateRow: true }).caption).toBe(
    "Built-in",
  );
});

test("the native size: the EDID's preferred one, unless the screen offers one larger both ways", () => {
  const mode = (width: number, height: number, preferred = false) => ({ width, height, refreshMhz: 60_000, preferred, current: false });
  // QEMU's monitor prefers 640 × 480 and offers up to 5120 × 2160: no size is called native.
  expect(nativeSize([mode(5120, 2160), mode(1920, 1200), mode(640, 480, true)])).toBeNull();
  // A 4K screen that also takes the cinema width keeps its own.
  expect(nativeSize([mode(4096, 2160), mode(3840, 2160, true), mode(1920, 1080)])).toEqual({ width: 3840, height: 2160 });
  expect(nativeSize([mode(2880, 1800, true), mode(1920, 1200)])).toEqual({ width: 2880, height: 1800 });
  expect(nativeSize([mode(1920, 1200)])).toBeNull();
});

test("aspect names", () => {
  expect(aspectLabel(2880, 1800)).toBe("16:10");
  expect(aspectLabel(1920, 1080)).toBe("16:9");
  expect(aspectLabel(3440, 1440)).toBe("21:9");
  expect(aspectLabel(3000, 2000)).toBe("3:2");
  expect(aspectLabel(1366, 768)).toBeNull();
  expect(aspectLabel(0, 768)).toBeNull();
});

test("the chosen display: the one asked for while it is on, else the main one", () => {
  const a = monitor({ name: "eDP-1", primary: false });
  const b = monitor({ name: "DP-1", primary: true, builtIn: false });
  const off = monitor({ name: "HDMI-A-1", enabled: false, primary: false });
  expect(chosenMonitor([a, b, off], null)?.name).toBe("DP-1");
  expect(chosenMonitor([a, b, off], "eDP-1")?.name).toBe("eDP-1");
  expect(chosenMonitor([a, b, off], "HDMI-A-1")?.name).toBe("DP-1");
  expect(chosenMonitor([off], null)).toBeNull();
});

test("the scale pills: the one in use and its neighbours, Other… for the rest", () => {
  const all = [1, 1.25, 1.5, 1.75, 2];
  expect(scaleOffer(all, 1.75)).toEqual({ shown: [1.5, 1.75, 2], more: true });
  expect(scaleOffer(all, 1)).toEqual({ shown: [1, 1.25, 1.5], more: true });
  expect(scaleOffer([1, 1.25], 1)).toEqual({ shown: [1, 1.25], more: false });
});

test("the Control Center miniature: rows 44, 7 apart, in 300", () => {
  expect(miniatureFrame({ col: 0, row: 0, cols: 2, rows: 1 })).toEqual({ left: 0, top: 0, width: 137, height: 44 });
  expect(miniatureFrame({ col: 2, row: 0, cols: 1, rows: 3 })).toEqual({ left: 144, top: 0, width: 65, height: 146 });
  const last = miniatureFrame({ col: 0, row: 4, cols: 4, rows: 1 });
  expect(last.left + last.width).toBe(MINIATURE.width - 2 * MINIATURE.padding);
  expect(
    miniatureHeight([
      { row: 0, rows: 3 },
      { row: 3, rows: 1 },
    ]),
  ).toBe(2 * 10 + 4 * 44 + 3 * 7);
  expect(miniatureHeight([])).toBe(20);
});

test("Control Center's sliders: tall only when every slider stands; changing it leaves the rest", () => {
  const isSlider = (id: string) => id === "volume" || id === "brightness";
  const layout = [
    { id: "wifi", size: "wide" as const },
    { id: "volume", size: "tall" as const },
    { id: "brightness", size: "flat" as const },
  ];
  expect(slidersShape(layout, isSlider)).toBe("flat");
  const tall = withSliders(layout, isSlider, "tall");
  expect(tall).toEqual([
    { id: "wifi", size: "wide" },
    { id: "volume", size: "tall" },
    { id: "brightness", size: "tall" },
  ]);
  expect(slidersShape(tall, isSlider)).toBe("tall");
  expect(slidersShape([{ id: "wifi", size: "wide" }], isSlider)).toBe("flat");
});

test("applets' controls, grouped under their applet", () => {
  expect(
    appletOffers([
      { appletName: "ASUS Control", title: "Lid light" },
      { appletName: "ASUS Control", title: "Fans" },
      { appletName: "Weather", title: "Units" },
      { appletName: "ASUS Control", title: "CPU" },
    ]),
  ).toEqual([
    { applet: "ASUS Control", titles: ["Lid light", "Fans", "CPU"] },
    { applet: "Weather", titles: ["Units"] },
  ]);
});

test("On battery in a few words, only what the machine lowers", () => {
  const rates = { battery: { refreshMhz: 60_000 }, plugged: { refreshMhz: 120_000 } };
  const screen = { choice: "automatic" as const, rates, decision: { why: "On battery", offered: true } };
  expect(onBatteryLine({ choice: "automatic" }, screen as never)).toBe("The graphics card sleeps · 60 Hz");
  expect(onBatteryLine(null, screen as never)).toBe("60 Hz");
  expect(onBatteryLine({ choice: "smart" }, null)).toBe("Smart, as you chose");
  expect(onBatteryLine(null, null)).toBeNull();
});

test("time pills: short words, Never last", () => {
  expect(
    timePills([
      { value: 0, label: "Never" },
      { value: 60, label: "1 minute" },
      { value: 300, label: "5 minutes" },
      { value: 3600, label: "1 hour" },
      { value: 7200, label: "2 hours" },
    ]),
  ).toEqual([
    { value: 60, label: "1 min" },
    { value: 300, label: "5 min" },
    { value: 3600, label: "1 h" },
    { value: 7200, label: "2 h" },
    { value: 0, label: "Never" },
  ]);
});

test("Night Shift's row and the tracking speed in words", () => {
  expect(describeSchedule("21:00", "07:00")).toBe("On from 9 PM to 7 AM");
  expect(describeSchedule(undefined, "07:00")).toBe("Only when you switch it");
  expect([trackingWords(-0.4), trackingWords(0), trackingWords(0.6)]).toEqual(["Slower", "Default", "Faster"]);
});

test("Agents' count: the agents whose sheet waits for you", () => {
  expect(waitingCount([])).toBe(0);
  expect(waitingCount([{ status: "Connected" }, { status: "Waiting for you" }, { status: "Waiting for you" }])).toBe(2);
});
