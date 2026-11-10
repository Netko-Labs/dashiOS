import { expect, test } from "bun:test";
import { AutoRefresh, POWER_STEADY_MS } from "../src/display-config/auto-refresh.ts";
import type { ApplyResult, ChangeOptions, ModeChange } from "../src/display-config/manager.ts";
import type { Mode, Monitor } from "../src/display-config/monitors.ts";
import type { RefreshChoice } from "../src/display-config/refresh-policy.ts";
import { Steady } from "../src/display-config/steady.ts";
import { panel } from "./support/refresh-rate.ts";

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
