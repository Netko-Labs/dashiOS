import { expect, test } from "bun:test";
import type { NativeHostOptions, NativeHostTransport, NativeWindowOptions } from "@mirinjs/metal";
import { View } from "@mirinjs/metal";
import { createElement } from "react";
import { openPopoverWindow } from "../src/popover.tsx";
import { REWARM_MS, WARM_AFTER_MS, WarmHost, type WarmTimers } from "../src/warm-host.ts";

function fakeHosts() {
  const spawned: { options: NativeHostOptions; opened: NativeWindowOptions[]; die: () => void }[] = [];
  const spawn = (_binary: string, options: NativeHostOptions): NativeHostTransport => {
    const closers: (() => void)[] = [];
    const record = {
      options,
      opened: [] as NativeWindowOptions[],
      die: () => {
        for (const closer of closers) closer();
      },
    };
    spawned.push(record);
    return {
      send() {},
      hide() {},
      onEvent() {},
      onClose: (listener) => closers.push(listener),
      simulate() {},
      close() {},
      onToplevel() {},
      toplevel() {},
      unlock() {},
      setTitle() {},
      open: (window) => record.opened.push(window),
    };
  };
  return { spawned, spawn };
}

function fakeTimers() {
  const due: { run: () => void; ms: number }[] = [];
  const timers: WarmTimers = {
    set: (run, ms) => {
      const timer = { run, ms };
      due.push(timer);
      return timer;
    },
    clear: (timer) => {
      const at = due.indexOf(timer as (typeof due)[number]);
      if (at >= 0) due.splice(at, 1);
    },
  };
  /** Run what is due, as time passing would; resolves once the warm-up's check has settled. */
  const pass = async (): Promise<number[]> => {
    const ran = due.splice(0).map((timer) => {
      timer.run();
      return timer.ms;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return ran;
  };
  return { due, timers, pass };
}

const window = { title: "Weather", appId: "dev.example.weather", width: 400, height: 160 };

test("an applet's host starts a moment after the applet, named for screen readers, and opens on demand", async () => {
  const { spawned, spawn } = fakeHosts();
  const { due, timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, spawn, timers });
  warm.start();
  expect(spawned).toHaveLength(0);
  expect(await pass()).toEqual([WARM_AFTER_MS]);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.options).toEqual({ deferred: true, env: { MIRIN_METAL_APP_NAME: "Weather" } });
  expect(warm.isReady()).toBe(true);

  expect(warm.take(window)).not.toBeNull();
  expect(spawned[0]?.opened).toEqual([window]);
  // Taken: the next starts a moment later, not at once.
  expect(warm.take(window)).toBeNull();
  expect(due.map((timer) => timer.ms)).toEqual([REWARM_MS]);
  await pass();
  expect(spawned).toHaveLength(2);
  warm.stop();
  expect(warm.take(window)).toBeNull();
});

test("a host binary from before deferred hosts is never kept warm", async () => {
  const { spawned, spawn } = fakeHosts();
  const { timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/old-host", appName: "Weather", supports: async () => false, spawn, timers });
  warm.start();
  await pass();
  expect(spawned).toHaveLength(0);
  expect(warm.take(window)).toBeNull();
});

test("a warm host that dies is replaced, never handed out", async () => {
  const { spawned, spawn } = fakeHosts();
  const { due, timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, spawn, timers });
  warm.start();
  await pass();
  spawned[0]?.die();
  expect(warm.take(window)).toBeNull();
  expect(due.map((timer) => timer.ms)).toEqual([REWARM_MS]);
  await pass();
  expect(warm.isReady()).toBe(true);
});

test("a popover or view opens on the warm host when one is ready, else on a new one", async () => {
  const { spawned, spawn } = fakeHosts();
  const { timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, spawn, timers });
  warm.start();
  await pass();
  const placement = { x: 10, y: 20, width: 400, height: 160, namespace: "dashi.applet.weather.view", output: null };
  const cold: NativeHostOptions[] = [];
  const coldSpawn = (binary: string, options: NativeHostOptions = {}): NativeHostTransport => {
    cold.push(options);
    return spawn(binary, options);
  };
  const first = openPopoverWindow({
    appId: "dev.example.weather",
    title: "Weather",
    placement,
    element: createElement(View),
    onClosed() {},
    spawn: coldSpawn,
    warm,
  });
  expect(cold).toHaveLength(0);
  expect(spawned[0]?.opened[0]).toMatchObject({ title: "Weather", width: 400, height: 160, surface: { margin: { top: 20, left: 10 } } });
  first.close();
  // None ready yet: a new host, named all the same.
  const second = openPopoverWindow({
    appId: "dev.example.weather",
    title: "Weather",
    placement,
    element: createElement(View),
    onClosed() {},
    spawn: coldSpawn,
    warm,
  });
  expect(cold).toHaveLength(1);
  expect(cold[0]?.env).toEqual({ MIRIN_METAL_APP_NAME: "Weather" });
  second.close();
  warm.stop();
});
