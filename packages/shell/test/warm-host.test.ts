import { expect, test } from "bun:test";
import type { NativeHostOptions, NativeHostTransport, NativeWindowOptions } from "@mirinjs/metal";

import { WarmHost } from "../src/warm-host.ts";

function fakeHosts() {
  const spawned: {
    options: NativeHostOptions;
    opened: NativeWindowOptions[];
    close: () => void;
  }[] = [];
  const spawn = (_binary: string, options: NativeHostOptions): NativeHostTransport => {
    const closers: (() => void)[] = [];
    const record = {
      options,
      opened: [] as NativeWindowOptions[],
      close: () => {
        for (const closer of closers) closer();
      },
    };
    spawned.push(record);
    return {
      send() {},
      onEvent() {},
      onClose: (listener) => closers.push(listener),
      simulate() {},
      close() {},
      onToplevel() {},
      toplevel() {},
      unlock() {},
      open: (window) => record.opened.push(window),
    };
  };
  return { spawned, spawn };
}

test("a host that knows deferred windows is kept warm and opened on demand", async () => {
  const { spawned, spawn } = fakeHosts();
  const warm = new WarmHost("/host", async () => true, spawn);
  expect(await warm.ready()).toBe(true);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]?.options.deferred).toBe(true);
  const host = warm.take({ title: "Launcher", width: 640, height: 120 });
  expect(host).not.toBeNull();
  expect(spawned[0]?.opened).toEqual([{ title: "Launcher", width: 640, height: 120 }]);
  // Taken: none until the next one warms.
  expect(warm.take({ title: "Menu" })).toBeNull();
  warm.stop();
});

test("an older host is never kept warm", async () => {
  const { spawned, spawn } = fakeHosts();
  const warm = new WarmHost("/old-host", async () => false, spawn);
  expect(await warm.ready()).toBe(false);
  expect(spawned).toHaveLength(0);
  expect(warm.take({ title: "Launcher" })).toBeNull();
});

test("a warm host that dies is not handed out", async () => {
  const { spawned, spawn } = fakeHosts();
  const warm = new WarmHost("/host", async () => true, spawn);
  await warm.ready();
  spawned[0]?.close();
  expect(warm.take({ title: "Launcher" })).toBeNull();
  warm.stop();
});
