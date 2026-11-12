/**
 * Mirroring (display-config/mirror.ts): which screen the others show, the
 * `mirror` requests that turn it on and off, how a mirroring screen is read
 * (monitors.ts, displays.ts) and left alone by the arrangement (plan.ts), and
 * Control Center's Mirroring tile.
 */

import { expect, test } from "bun:test";
import type { CompositorEvent } from "../src/compositor/events.ts";
import { outputsOf } from "../src/compositor/outputs.ts";
import { type ControlSnapshot, isThere, tileState } from "../src/control-center/catalog.ts";
import { MirrorStore, mirrorRequests, mirrorSource, mirrorStateOf } from "../src/display-config/mirror.ts";
import { monitorsOf } from "../src/display-config/monitors.ts";
import { configOf, layoutOf, planRestore } from "../src/display-config/plan.ts";
import { screensOf } from "../src/displays.ts";
import { fakeCompositor } from "./support/compositor.ts";

const output = (name: string, x: number, extra: Record<string, unknown> = {}) => ({
  name,
  make: name.startsWith("eDP") ? "BOE" : "Dell",
  model: name.startsWith("eDP") ? "NE160QDM" : "U2720Q",
  serial: "",
  enabled: true,
  lit: true,
  primary: name === "eDP-1",
  physicalMm: { width: 340, height: 220 },
  scale: 1,
  transform: { rotation: 0, flipped: false },
  mode: { width: 1920, height: 1080, refreshMhz: 60000 },
  modes: [{ width: 1920, height: 1080, refreshMhz: 60000, preferred: true, current: true }],
  frame: { x, y: 0, width: 1920, height: 1080 },
  vrr: { supported: false, active: false, mode: "off" },
  ...extra,
});

const apart = { outputs: [output("eDP-1", 0), output("HDMI-A-1", 1920)] };
const mirrored = { outputs: [output("eDP-1", 0), output("HDMI-A-1", 1920, { frame: null, usable: null, mirrorOf: "eDP-1" })] };

test("the others show the built-in screen, else the main one; one screen has nothing to mirror", () => {
  expect(mirrorSource(monitorsOf(outputsOf(apart)))).toBe("eDP-1");
  const desk = { outputs: [output("DP-1", 0), output("DP-2", 1920, { primary: true })] };
  expect(mirrorSource(monitorsOf(outputsOf(desk)))).toBe("DP-2");
  expect(mirrorSource(monitorsOf(outputsOf({ outputs: [output("eDP-1", 0)] })))).toBeNull();
  // A screen turned off is not one of them.
  expect(
    mirrorSource(monitorsOf(outputsOf({ outputs: [output("eDP-1", 0), output("HDMI-A-1", 1920, { enabled: false, mode: null, frame: null })] }))),
  ).toBeNull();
});

test("on asks each other screen to show the source; off gives each its own desktop back", () => {
  expect(mirrorRequests(monitorsOf(outputsOf(apart)), true)).toEqual([{ output: "HDMI-A-1", source: "eDP-1" }]);
  expect(mirrorRequests(monitorsOf(outputsOf(apart)), false)).toEqual([]);
  expect(mirrorRequests(monitorsOf(outputsOf(mirrored)), false)).toEqual([{ output: "HDMI-A-1", source: null }]);
  // Already on: nothing more to ask.
  expect(mirrorRequests(monitorsOf(outputsOf(mirrored)), true)).toEqual([]);
  const three = { outputs: [output("eDP-1", 0), output("HDMI-A-1", 1920), output("DP-1", 3840)] };
  expect(mirrorRequests(monitorsOf(outputsOf(three)), true).map((request) => request.output)).toEqual(["HDMI-A-1", "DP-1"]);
});

test("a mirroring screen is a monitor that is on, but not a screen of its own, and the arrangement leaves it be", () => {
  const monitors = monitorsOf(outputsOf(mirrored));
  expect(monitors[1]?.mirrorOf).toBe("eDP-1");
  expect(monitors[0]?.mirrorOf).toBeUndefined();
  expect(mirrorStateOf(monitors)).toEqual({ screens: 2, on: true });
  expect(mirrorStateOf(monitorsOf(outputsOf(apart)))).toEqual({ screens: 2, on: false });
  expect(screensOf(outputsOf(mirrored)).map((screen) => screen.name)).toEqual(["eDP-1"]);
  // A saved arrangement would move it (and end its mirroring): it isn't planned.
  const saved = layoutOf(monitorsOf(outputsOf(apart)), undefined, false);
  const moved = { ...saved, monitors: { ...saved.monitors } };
  const key = Object.keys(moved.monitors).find((identity) => identity.includes("Dell")) ?? "";
  moved.monitors[key] = { enabled: true, x: 0, y: 1080, rotation: 0, flipped: false };
  const plan = planRestore(monitors, moved, { lidClosed: false, scaleFor: () => 1 });
  expect(plan?.outputs.some((config) => config.name === "HDMI-A-1") ?? false).toBe(false);
  // Undoing another change leaves it mirroring; its place on the desk is kept for when it stops.
  expect(configOf(monitors).outputs.map((config) => config.name)).toEqual(["eDP-1"]);
  expect(layoutOf(monitors, saved, false).monitors[key]).toEqual(saved.monitors[key]);
});

test("the store follows the screens and turns mirroring on and off", async () => {
  let answer: unknown = apart;
  const sent: Array<[string, unknown]> = [];
  const listeners = new Set<(event: CompositorEvent) => void>();
  const compositor = fakeCompositor(
    async (method, params) => {
      sent.push([method, params]);
      if (method === "mirror") answer = params?.source ? mirrored : apart;
      return method === "outputs" ? answer : {};
    },
    {
      on: (listener: (event: CompositorEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  );
  const store = new MirrorStore(compositor);
  const stop = store.start();
  await store.refresh();
  expect(store.getSnapshot()).toEqual({ screens: 2, on: false });
  await store.set(true);
  expect(sent.filter(([method]) => method === "mirror")).toEqual([["mirror", { output: "HDMI-A-1", source: "eDP-1" }]]);
  expect(store.getSnapshot().on).toBe(true);
  // Unplugged: the compositor ends it, and the store hears.
  answer = { outputs: [output("eDP-1", 0)] };
  for (const listener of listeners) listener({ event: "outputs-changed" });
  await store.refresh();
  expect(store.getSnapshot()).toEqual({ screens: 1, on: false });
  stop();
  expect(listeners.size).toBe(0);
});

test("Control Center's Mirroring tile is there only with two screens or more", () => {
  const base = { wifi: null, network: null, bluetooth: null, bluetoothDevice: null, brightness: null, volume: null } as const;
  const snap: ControlSnapshot = {
    ...base,
    dnd: false,
    dark: false,
    night: false,
    power: null,
    light: null,
    graphics: null,
    battery: null,
    hotspot: null,
    mirroring: null,
  };
  expect(isThere("mirror", snap)).toBe(false);
  expect(tileState("mirror", snap)).toBeNull();
  expect(tileState("mirror", { ...snap, mirroring: false })).toMatchObject({ title: "Mirroring", detail: "Off", on: false });
  expect(tileState("mirror", { ...snap, mirroring: true })).toMatchObject({ title: "Mirroring", detail: "On", on: true });
});
