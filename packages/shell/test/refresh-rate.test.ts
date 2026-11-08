import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AutoRefresh, POWER_STEADY_MS } from "../src/display-config/auto-refresh.ts";
import type { ApplyResult, ChangeOptions, ModeChange } from "../src/display-config/manager.ts";
import type { Mode, Monitor, OfferedMode } from "../src/display-config/monitors.ts";
import { autoRates, decideRefresh, type RefreshChoice } from "../src/display-config/refresh-policy.ts";
import { Steady } from "../src/display-config/steady.ts";
import { graphicsOnBattery, refreshOnBattery } from "../src/settings-app/panes/on-battery.tsx";
import { readSettings, SettingsStore } from "../src/settings-app/store.ts";

const dir = mkdtempSync(join(tmpdir(), "dashi-refresh-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const offered = (width: number, height: number, refreshMhz: number, preferred = false): OfferedMode => ({
  width,
  height,
  refreshMhz,
  preferred,
  current: false,
});

/** The G14's panel: 2880 × 1800 at 120 and 60, and a smaller size at 144. */
const G14_MODES = [offered(2880, 1800, 120_000, true), offered(2880, 1800, 60_000), offered(1920, 1200, 144_000), offered(1920, 1200, 60_000)];

function panel(refreshMhz: number, overrides: Partial<Monitor> = {}): Monitor {
  return {
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
    mode: { width: 2880, height: 1800, refreshMhz },
    modes: G14_MODES,
    rotation: 0,
    flipped: false,
    vrr: { supported: false, active: false, mode: "off" },
    ...overrides,
  };
}

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

/** Timers run by hand. */
function clock() {
  let now = 0;
  const timers = new Set<{ at: number; fn: () => void }>();
  return {
    later: (fn: () => void, ms: number) => {
      const timer = { at: now + ms, fn };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    advance(ms: number) {
      now += ms;
      for (const timer of [...timers].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) continue;
        timers.delete(timer);
        timer.fn();
      }
    },
    get pending() {
      return timers.size;
    },
  };
}

test("the power source counts at once the first time, after it holds every time after", () => {
  const time = clock();
  const seen: boolean[] = [];
  const steady = new Steady<boolean>(5000, (value) => seen.push(value), time.later);
  steady.set(true);
  expect(seen).toEqual([true]);
  // A loose charger: out and back within the wait is nothing.
  steady.set(false);
  time.advance(2000);
  steady.set(true);
  time.advance(10_000);
  expect(seen).toEqual([true]);
  // Unplugged for good: counts once it has held; reading it again doesn't restart the wait.
  steady.set(false);
  time.advance(3000);
  steady.set(false);
  time.advance(2000);
  expect(seen).toEqual([true, false]);
  expect(steady.value).toBe(false);
  steady.set(true);
  steady.close();
  time.advance(10_000);
  expect(seen).toEqual([true, false]);
});

/** The display manager as Automatic sees it: screens, and their modes set as asked. */
function fakeDisplays(monitors: Monitor[]) {
  const listeners = new Set<(change: ModeChange) => void>();
  const sets: Array<{ name: string; mode: Mode; by: string }> = [];
  const tell = (change: ModeChange) => {
    for (const listener of listeners) listener(change);
  };
  return {
    sets,
    monitors: async () => monitors.map((monitor) => ({ ...monitor })),
    onModeChange: (listener: (change: ModeChange) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setMode: async (name: string, mode: Pick<Mode, "width" | "height"> & { refreshMhz?: number }, options: ChangeOptions = {}): Promise<ApplyResult> => {
      const monitor = monitors.find((each) => each.name === name);
      if (!monitor) return { kept: false, reverted: false, error: "no such screen" };
      monitor.mode = { width: mode.width, height: mode.height, refreshMhz: mode.refreshMhz ?? 60_000 };
      sets.push({ name, mode: monitor.mode, by: options.by ?? "manual" });
      tell({ cause: options.by === "automatic" ? "automatic" : "manual", names: [name] });
      return { kept: true, reverted: false };
    },
    restore: (name: string, refreshMhz: number) => {
      const monitor = monitors.find((each) => each.name === name);
      if (monitor?.mode) monitor.mode = { ...monitor.mode, refreshMhz };
      tell({ cause: "restore", names: [name] });
    },
  };
}

function setup(monitors: Monitor[] = [panel(120_000), panel(60_000, { name: "DP-1", builtIn: false })]) {
  const time = clock();
  const displays = fakeDisplays(monitors);
  const choices = new Map<string, RefreshChoice>();
  let ready = true;
  const refresh = new AutoRefresh({
    displays,
    choice: (name) => choices.get(name) ?? "automatic",
    ready: () => ready,
    later: time.later,
  });
  refresh.start();
  return {
    time,
    displays,
    choices,
    refresh,
    rate: (name = "eDP-1") => monitors.find((monitor) => monitor.name === name)?.mode?.refreshMhz,
    setReady(value: boolean) {
      ready = value;
    },
  };
}

test("at login on battery the panel goes to 60 Hz; unplugging and plugging follow once the source holds", async () => {
  const run = setup();
  run.refresh.setPlugged(false);
  await run.refresh.idle();
  expect(run.rate()).toBe(60_000);
  expect(run.rate("DP-1")).toBe(60_000);
  expect(run.displays.sets).toEqual([{ name: "eDP-1", mode: { width: 2880, height: 1800, refreshMhz: 60_000 }, by: "automatic" }]);
  expect(run.refresh.getSnapshot().screens.map((screen) => screen.decision.why)).toEqual(["Automatic: 60 Hz on battery"]);
  run.refresh.setPlugged(true);
  await run.refresh.idle();
  expect(run.rate()).toBe(60_000);
  run.time.advance(POWER_STEADY_MS);
  await run.refresh.idle();
  expect(run.rate()).toBe(120_000);
  expect(run.refresh.getSnapshot().plugged).toBe(true);
});

test("a rate set another way holds until the power source changes; the external screen is never set", async () => {
  const run = setup();
  run.refresh.setPlugged(false);
  await run.refresh.idle();
  // An agent's set_display_mode puts the panel back to 120 Hz for the session.
  await run.displays.setMode("eDP-1", { width: 2880, height: 1800, refreshMhz: 120_000 });
  await run.refresh.idle();
  expect(run.rate()).toBe(120_000);
  // Putting the arrangement back (the lid, a monitor) doesn't undo it either.
  run.displays.restore("eDP-1", 120_000);
  await run.refresh.idle();
  expect(run.rate()).toBe(120_000);
  expect(run.refresh.getSnapshot().screens[0]?.decision.why).toBe("120 Hz for now. Automatic picks again when you plug in");
  run.refresh.setPlugged(true);
  run.time.advance(POWER_STEADY_MS);
  await run.refresh.idle();
  run.refresh.setPlugged(false);
  run.time.advance(POWER_STEADY_MS);
  await run.refresh.idle();
  expect(run.rate()).toBe(60_000);
  expect(run.displays.sets.filter((set) => set.name === "DP-1")).toEqual([]);
});

test("a restored arrangement at the wrong rate is followed by Automatic", async () => {
  const run = setup();
  run.refresh.setPlugged(false);
  await run.refresh.idle();
  run.displays.restore("eDP-1", 120_000);
  await run.refresh.idle();
  expect(run.rate()).toBe(60_000);
});

test("a fixed pick is left alone, and turning Automatic back on sets the rate at once", async () => {
  const run = setup();
  run.choices.set("eDP-1", "fixed");
  run.refresh.setPlugged(false);
  await run.refresh.idle();
  expect(run.rate()).toBe(120_000);
  expect(run.refresh.getSnapshot().screens[0]?.decision.why).toBe("120 Hz, chosen by you");
  run.choices.delete("eDP-1");
  run.refresh.settingsChanged();
  await run.refresh.idle();
  expect(run.rate()).toBe(60_000);
});

test("nothing is set while the screens are blanked or the session is locked; the change waits for them", async () => {
  const run = setup();
  run.setReady(false);
  run.refresh.setPlugged(false);
  await run.refresh.idle();
  expect(run.rate()).toBe(120_000);
  run.refresh.readyChanged();
  await run.refresh.idle();
  expect(run.rate()).toBe(120_000);
  run.setReady(true);
  run.refresh.readyChanged();
  await run.refresh.idle();
  expect(run.rate()).toBe(60_000);
});
