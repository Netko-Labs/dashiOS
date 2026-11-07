/** The Dock's Quit asks as ❖Q does: each app hears it quits before its window is asked to close. */

import { expect, test } from "bun:test";
import type { CompositorWindow } from "../src/compositor.ts";
import { DockController } from "../src/dock/controller.ts";

test("Quit tells each window's app it quits, then asks the window to close", async () => {
  const heard: string[] = [];
  const windows: CompositorWindow[] = [
    { id: 4, appId: "dev.dashi.terminal", title: "~", pid: 401, focused: true, state: "normal", frame: null, titleBar: 0 },
    { id: 5, appId: "dev.dashi.terminal", title: "~/dashi", pid: 502, focused: false, state: "normal", frame: null, titleBar: 0 },
  ];
  const controller = new DockController({
    catalog: [],
    pins: { pin: () => {}, unpin: () => {} },
    toplevels: { act: (id: number, action: string) => void heard.push(`${action} ${id}`), getSnapshot: () => [], subscribe: () => () => {} },
    compositor: { windows: async () => windows, request: async () => ({}) },
    launch: () => null,
    appQuitting: (pid: number | null) => void heard.push(`quitting ${pid}`),
  } as unknown as ConstructorParameters<typeof DockController>[0]);
  await controller.run({ kind: "quit", windows: [4, 5] });
  expect(heard).toEqual(["quitting 401", "close 4", "quitting 502", "close 5"]);
  controller.close();
});
