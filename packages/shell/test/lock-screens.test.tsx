/**
 * The lock screen on every screen (D554): the whole lock where the person
 * is, a cover on each other screen; screens plugged in or out while locked;
 * one password unlocks them all.
 */

import { expect, test } from "bun:test";
import type { NativeHostOptions, NativeHostTransport } from "@mirinjs/metal";
import type { CompositorEvent } from "../src/compositor/events.ts";
import { outputsOf } from "../src/compositor/outputs.ts";
import { type LockCompositor, LockController } from "../src/lock/controller.tsx";
import { planLock } from "../src/lock/lib/screens.ts";
import { settle } from "./support/time.ts";

test("the whole lock where the person is, a cover on each other screen, and it stays put", () => {
  expect(planLock(["eDP-1", "HDMI-A-1"], "HDMI-A-1", undefined)).toEqual({ main: "HDMI-A-1", covers: ["eDP-1"] });
  expect(planLock(["eDP-1", "HDMI-A-1"], undefined, undefined)).toEqual({ main: "eDP-1", covers: ["HDMI-A-1"] });
  // Already on the TV: the pointer moving does not move it.
  expect(planLock(["eDP-1", "HDMI-A-1"], "eDP-1", "HDMI-A-1")).toEqual({ main: "HDMI-A-1", covers: ["eDP-1"] });
  // The TV unplugged: the whole lock moves to the laptop.
  expect(planLock(["eDP-1"], undefined, "HDMI-A-1")).toEqual({ main: "eDP-1", covers: [] });
  expect(planLock([], undefined, undefined)).toEqual({ main: undefined, covers: [] });
});

const screen = (name: string, x: number) => ({
  name,
  make: "",
  model: name,
  serial: "",
  enabled: true,
  lit: true,
  primary: x === 0,
  physicalMm: { width: 0, height: 0 },
  scale: 1,
  transform: { rotation: 0, flipped: false },
  mode: { width: 1920, height: 1080, refreshMhz: 60000 },
  modes: [],
  frame: { x, y: 0, width: 1920, height: 1080 },
  vrr: { supported: false, active: false, mode: "off" },
});

interface FakeHost {
  output: string | undefined;
  closed: boolean;
  unlocked: boolean;
}

function harness(names: string[], pointer: { x: number; y: number } | null) {
  let outputs = names.map((name, index) => screen(name, index * 1920));
  const listeners = new Set<(event: CompositorEvent) => void>();
  const hosts: FakeHost[] = [];
  const compositor: LockCompositor = {
    session: async () => ({ waylandDisplay: "wayland-1", display: null, xwayland: "off", pointer, locked: false }),
    outputs: async () => outputsOf({ outputs }),
    windows: async () => [],
    capture: async () => ({}),
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const spawn = (options: NativeHostOptions): NativeHostTransport => {
    const surface = options.surface;
    const fake: FakeHost = { output: surface && "output" in surface ? surface.output : undefined, closed: false, unlocked: false };
    hosts.push(fake);
    const closers: Array<() => void> = [];
    const transport = {
      send() {},
      onEvent() {},
      onClose: (listener: () => void) => closers.push(listener),
      simulate() {},
      close() {
        fake.closed = true;
      },
      unlock() {
        fake.unlocked = true;
      },
    };
    return transport as unknown as NativeHostTransport;
  };
  const controller = new LockController(compositor, spawn);
  return {
    controller,
    hosts,
    replug(next: string[]) {
      outputs = next.map((name, index) => screen(name, index * 1920));
      for (const listener of [...listeners]) listener({ event: "outputs-changed" } as CompositorEvent);
    },
  };
}

test("locking covers every screen, the whole lock on the pointer's", async () => {
  const run = harness(["eDP-1", "HDMI-A-1"], { x: 2500, y: 300 });
  run.controller.lock();
  await settle();
  expect(run.hosts.map((host) => host.output)).toEqual(["HDMI-A-1", "eDP-1"]);
  expect(run.controller.isLocked).toBe(true);
});

test("a screen plugged in while locked is covered; one unplugged is let go; nothing doubles", async () => {
  const run = harness(["eDP-1"], { x: 100, y: 100 });
  run.controller.lock();
  await settle();
  run.replug(["eDP-1", "HDMI-A-1"]);
  await settle();
  expect(run.hosts.filter((host) => !host.closed).map((host) => host.output)).toEqual(["eDP-1", "HDMI-A-1"]);
  run.replug(["eDP-1"]);
  await settle();
  expect(run.hosts.filter((host) => !host.closed).map((host) => host.output)).toEqual(["eDP-1"]);
  run.replug(["eDP-1", "HDMI-A-1"]);
  run.replug(["eDP-1", "HDMI-A-1"]);
  await settle();
  expect(run.hosts.filter((host) => !host.closed).map((host) => host.output)).toEqual(["eDP-1", "HDMI-A-1"]);
});

test("the whole lock's screen unplugged: it opens again on a screen that is left", async () => {
  const run = harness(["eDP-1", "HDMI-A-1"], { x: 2500, y: 300 });
  run.controller.lock();
  await settle();
  run.replug(["eDP-1"]);
  await settle();
  const open = run.hosts.filter((host) => !host.closed);
  expect(open.map((host) => host.output)).toEqual(["eDP-1"]);
  // The cover that was there made way for the whole lock: a new host, not the cover.
  expect(open[0]).toBe(run.hosts[2]);
});
