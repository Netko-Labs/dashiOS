import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeHostOptions, NativeHostTransport, NativeWindowOptions } from "@mirinjs/metal";
import { View } from "@mirinjs/metal";
import { createElement } from "react";
import { openPopoverWindow } from "../src/popover.tsx";
import { compositorIsThere, REWARM_MAX_MS, REWARM_MS, rewarmDelay, WARM_AFTER_MS, WarmHost, type WarmTimers } from "../src/warm-host.ts";
import { flush } from "./support/time.ts";

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
      setSize() {},
      setMinSize() {},
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
    await flush();
    return ran;
  };
  return { due, timers, pass };
}

const window = { title: "Weather", appId: "dev.example.weather", width: 400, height: 160 };

test("an applet's host starts a moment after the applet, named for screen readers, and opens on demand", async () => {
  const { spawned, spawn } = fakeHosts();
  const { due, timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, reachable: async () => true, spawn, timers });
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
  const warm = new WarmHost({ binary: "/old-host", appName: "Weather", supports: async () => false, reachable: async () => true, spawn, timers });
  warm.start();
  await pass();
  expect(spawned).toHaveLength(0);
  expect(warm.take(window)).toBeNull();
});

test("a warm host that dies is replaced, never handed out", async () => {
  const { spawned, spawn } = fakeHosts();
  const { due, timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, reachable: async () => true, spawn, timers });
  warm.start();
  await pass();
  spawned[0]?.die();
  expect(warm.take(window)).toBeNull();
  expect(due.map((timer) => timer.ms)).toEqual([REWARM_MS]);
  await pass();
  expect(warm.isReady()).toBe(true);
});

test("no host starts while the compositor is gone: it looks again later, each time after longer", async () => {
  const { spawned, spawn } = fakeHosts();
  const { timers, pass } = fakeTimers();
  let there = false;
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, reachable: async () => there, spawn, timers });
  warm.start();
  expect(await pass()).toEqual([WARM_AFTER_MS]);
  // The journal had a host's panic every 1.5 s (NoCompositor) until the shell started the applet again.
  expect(await pass()).toEqual([REWARM_MS * 2]);
  expect(await pass()).toEqual([REWARM_MS * 4]);
  expect(spawned).toHaveLength(0);
  there = true;
  await pass();
  expect(spawned).toHaveLength(1);
  expect(warm.isReady()).toBe(true);
  warm.stop();
});

test("hosts that keep dying before they are taken are tried less and less often; one that is taken puts the wait back", async () => {
  const { spawned, spawn } = fakeHosts();
  const { due, timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, reachable: async () => true, spawn, timers });
  warm.start();
  await pass();
  spawned[0]?.die();
  expect(await pass()).toEqual([REWARM_MS]);
  spawned[1]?.die();
  expect(await pass()).toEqual([REWARM_MS * 2]);
  spawned[2]?.die();
  expect(await pass()).toEqual([REWARM_MS * 4]);
  expect(warm.take(window)).not.toBeNull();
  expect(due.map((timer) => timer.ms)).toEqual([REWARM_MS]);
  await pass();
  spawned[4]?.die();
  expect(due.map((timer) => timer.ms)).toEqual([REWARM_MS]);
  expect(rewarmDelay(40)).toBe(REWARM_MAX_MS);
  warm.stop();
});

test("the compositor is there when its socket answers, and gone when the file is left with nobody behind it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-warm-"));
  const env = { XDG_RUNTIME_DIR: dir, WAYLAND_DISPLAY: "wayland-9" };
  expect(await compositorIsThere(env)).toBe(false);
  const server = Bun.listen({ unix: join(dir, "wayland-9"), socket: { data() {} } });
  expect(await compositorIsThere(env)).toBe(true);
  // Bun leaves the socket's file when a listener stops: a compositor that went.
  server.stop(true);
  expect(await compositorIsThere(env)).toBe(false);
  expect(await compositorIsThere({})).toBe(true);
});

test("a popover or view opens on the warm host when one is ready, else on a new one", async () => {
  const { spawned, spawn } = fakeHosts();
  const { timers, pass } = fakeTimers();
  const warm = new WarmHost({ binary: "/host", appName: "Weather", supports: async () => true, reachable: async () => true, spawn, timers });
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

test("an applet's popover draws on a solid ground, clipped to its corners, whatever its own tint", async () => {
  const sent: string[] = [];
  const host = {
    send: (frame: string) => sent.push(frame),
    hide() {},
    onEvent() {},
    onClose() {},
    simulate() {},
    close() {},
    onToplevel() {},
    toplevel() {},
    unlock() {},
    setTitle() {},
    setSize() {},
    setMinSize() {},
    open() {},
  } as unknown as NativeHostTransport;
  const popover = openPopoverWindow({
    appId: "dev.example.weather",
    title: "Weather",
    placement: { x: 10, y: 20, width: 400, height: 160, namespace: "dashi.applet", output: null },
    element: createElement(View, { testID: "glass", style: { flex: 1, backgroundColor: "#f5f5f7f5" } }),
    onClosed() {},
    spawn: () => host,
  });
  await flush();
  const tree = JSON.parse(sent.at(-1) ?? "{}") as { props: Record<string, unknown>; children: { props: Record<string, unknown> }[] };
  // The ground (solid card, the popover's radius, clipping), then the applet's own glass on it.
  expect(tree.props).toMatchObject({ background: "#ffffff", cornerRadius: 12, clip: true });
  expect(tree.children[0]?.props.background).toBe("#f5f5f7f5");
  popover.close();
});
