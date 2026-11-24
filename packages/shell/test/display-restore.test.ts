/**
 * What a set of monitors comes up with (display-config/plan.ts, manager.ts):
 * the mode a monitor nobody chose for runs (D552), the mode a monitor ran in
 * another set, and a default the screens refuse.
 */

import { expect, test } from "bun:test";
import { outputsOf } from "../src/compositor/outputs.ts";
import { settle } from "../src/display-config/layout.ts";
import { DisplayManager } from "../src/display-config/manager.ts";
import { defaultMode, monitorsOf, rateOf } from "../src/display-config/monitors.ts";
import { planRestore, settled } from "../src/display-config/plan.ts";
import { DisplayStore } from "../src/display-config/saved.ts";
import { fakeCompositor } from "./support/compositor.ts";

const mode = (width: number, height: number, hz: number, preferred = false, current = false) => ({ width, height, refreshMhz: hz * 1000, preferred, current });

/** The Samsung on HDMI: a TV that prefers 4K at 30 Hz and also takes 60, and 1080p up to 120. */
const tvModes = [mode(3840, 2160, 30, true, true), mode(3840, 2160, 60), mode(4096, 2160, 60), mode(1920, 1080, 120), mode(1920, 1080, 60)];

const output = (name: string, x: number, modes: ReturnType<typeof mode>[], extra: Record<string, unknown> = {}) => {
  const current = modes.find((each) => each.current) ?? modes[0];
  return {
    name,
    make: name.startsWith("eDP") ? "BOE" : "Samsung Electric Company",
    model: name.startsWith("eDP") ? "NE140" : "LS40BM",
    serial: "",
    enabled: true,
    lit: true,
    primary: name.startsWith("eDP"),
    physicalMm: name.startsWith("eDP") ? { width: 300, height: 190 } : { width: 890, height: 500 },
    scale: 1,
    transform: { rotation: 0, flipped: false },
    mode: current ? { width: current.width, height: current.height, refreshMhz: current.refreshMhz } : null,
    modes,
    frame: { x, y: 0, width: 1000, height: 600 },
    vrr: { supported: false, active: false, mode: "off" },
    ...extra,
  };
};

const laptop = output("eDP-1", 0, [mode(2880, 1800, 120, true, true), mode(2880, 1800, 60)]);
const options = { lidClosed: false, scaleFor: () => 1 };

test("a monitor nobody chose for runs its native size at its fastest rate there", () => {
  expect(defaultMode(monitorsOf(outputsOf({ outputs: [output("HDMI-A-1", 0, tvModes)] }))[0]?.modes ?? [])).toMatchObject({
    width: 3840,
    height: 2160,
    refreshMhz: 60000,
  });
  // A 1080p TV that prefers 60 Hz and takes 120 at its size runs at 120.
  const hd = [mode(1920, 1080, 60, true, true), mode(1920, 1080, 120), mode(1280, 720, 60)];
  expect(defaultMode(monitorsOf(outputsOf({ outputs: [output("HDMI-A-1", 0, hd)] }))[0]?.modes ?? [])).toMatchObject({
    width: 1920,
    height: 1080,
    refreshMhz: 120000,
  });
  // One that prefers less than it offers (QEMU's 640 × 480) has no native size: it keeps what it came up with.
  const qemu = [mode(640, 480, 120, true, true), mode(3840, 2160, 60), mode(1920, 1080, 60)];
  expect(defaultMode(monitorsOf(outputsOf({ outputs: [output("Virtual-1", 0, qemu)] }))[0]?.modes ?? [])).toBeUndefined();
});

test("plugged in with nothing saved, the TV is asked for 4K at 60, not left at 30", () => {
  const monitors = monitorsOf(outputsOf({ outputs: [laptop, output("HDMI-A-1", 1646, tvModes)] }));
  const plan = planRestore(monitors, undefined, options);
  expect(plan?.outputs).toEqual([{ name: "HDMI-A-1", mode: { width: 3840, height: 2160, refreshMhz: 60000 } }]);
  expect(planRestore(monitors, undefined, { ...options, defaultModes: false })).toBeNull();
});

test("a mode saved for the set wins, and a monitor new to the set runs the mode it last ran elsewhere", () => {
  const monitors = monitorsOf(outputsOf({ outputs: [laptop, output("HDMI-A-1", 1646, tvModes)] }));
  const tv = "edid:Samsung Electric Company|LS40BM||HDMI-A-1";
  const saved = {
    primary: null,
    monitors: { [tv]: { enabled: true, x: 1646, y: 0, rotation: 0 as const, flipped: false, mode: { width: 1920, height: 1080, refreshMhz: 120000 } } },
  };
  expect(planRestore(monitors, saved, options)?.outputs).toEqual([{ name: "HDMI-A-1", mode: { width: 1920, height: 1080, refreshMhz: 120000 } }]);
  const elsewhere = { ...options, lastMode: () => ({ width: 1920, height: 1080, refreshMhz: 60000 }) };
  // The laptop never ran 1920 × 1080: it keeps its own.
  expect(planRestore(monitors, undefined, elsewhere)?.outputs).toEqual([{ name: "HDMI-A-1", mode: { width: 1920, height: 1080, refreshMhz: 60000 } }]);
});

test("the store knows the mode a monitor ran in the arrangement saved last", () => {
  const store = new DisplayStore({ path: null });
  const entry = (width: number) => ({ enabled: true, x: 0, y: 0, rotation: 0 as const, flipped: false, mode: { width, height: 1080, refreshMhz: 60000 } });
  store.set("a", { primary: null, monitors: { tv: entry(1920) } });
  store.set("b", { primary: null, monitors: { tv: entry(2560), other: entry(1280) } });
  expect(store.lastMode("tv")?.width).toBe(2560);
  expect(store.lastMode("nobody")).toBeUndefined();
});

test("a default mode the screens refuse is dropped, and the rest of the arrangement still goes through", async () => {
  const outputs = { outputs: [laptop, output("HDMI-A-1", 1646, tvModes)] };
  const asked: unknown[] = [];
  const compositor = fakeCompositor(
    async (method, params) => {
      if (method === "outputs") return outputs;
      asked.push(params);
      const wire = (params?.outputs ?? []) as Array<Record<string, unknown>>;
      if (wire.some((each) => each.mode !== undefined)) throw new Error("the link cannot carry 3840 × 2160 at 60 Hz");
      return {};
    },
    { on: () => () => {} },
  );
  const manager = new DisplayManager({ compositor, store: new DisplayStore({ path: null }), scaleFor: (monitor) => (monitor.builtIn ? 1.75 : 1.5) });
  await manager.restore();
  expect(asked).toHaveLength(2);
  expect(asked[1]).toEqual({
    outputs: [
      { name: "eDP-1", scale: 1.75 },
      { name: "HDMI-A-1", scale: 1.5 },
    ],
  });
});

test("settle: a screen that grows pushes its neighbour along, one that shrinks pulls it in, the main one stays", () => {
  const grown = settle(
    [
      { name: "Virtual-1", x: 0, y: 0, width: 1098, height: 686 },
      { name: "Virtual-2", x: 640, y: 0, width: 1024, height: 768 },
    ],
    "Virtual-1",
  );
  expect(grown.map(({ name, x, y }) => ({ name, x, y }))).toEqual([
    { name: "Virtual-1", x: 0, y: 0 },
    { name: "Virtual-2", x: 1098, y: 0 },
  ]);
  const apart = settle(
    [
      { name: "eDP-1", x: 0, y: 0, width: 1646, height: 1029 },
      { name: "HDMI-A-1", x: 2400, y: 0, width: 2560, height: 1440 },
    ],
    "eDP-1",
  );
  expect(apart[1]).toMatchObject({ x: 1646, y: 0 });
  // A screen above the laptop that is free and touching keeps its place.
  const above = [
    { name: "eDP-1", x: 0, y: 0, width: 1646, height: 1029 },
    { name: "HDMI-A-1", x: -457, y: -1440, width: 2560, height: 1440 },
  ];
  expect(settle(above, "eDP-1")).toEqual(above);
});

test("a scale change asks for the neighbour's new place in the same request", () => {
  const two = { outputs: [laptop, output("HDMI-A-1", 1000, tvModes)] };
  const monitors = monitorsOf(outputsOf(two));
  // The laptop's 2880 pixels at 1.75 are 1646 points: the TV at 1000 would sit under it.
  expect(settled({ outputs: [{ name: "eDP-1", scale: 1.75 }] }, monitors).outputs).toEqual([
    { name: "eDP-1", scale: 1.75 },
    { name: "HDMI-A-1", position: { x: 1646, y: 0 } },
  ]);
});

test("the rate a screen runs is the nearest offered, not the first within 0.6 Hz", () => {
  // The VM's 1920 × 1200 offers 59.95 and 59.885 Hz and runs 59.885: Displays marked 59.95.
  expect(rateOf([59950, 59885], 59885)).toBe(59885);
  expect(rateOf([60000, 59940], 59950)).toBe(59940);
  expect(rateOf([120000], 59885)).toBeNull();
});
