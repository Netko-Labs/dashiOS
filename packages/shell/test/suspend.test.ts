import { expect, test } from "bun:test";
import type { CompositorEvent, CompositorWindow } from "../src/compositor.ts";
import { followSuspension, suspendChanges } from "../src/suspend.ts";
import { fakeCompositor } from "./support/compositor.ts";
import { flush } from "./support/time.ts";

const frame = { x: 0, y: 0, width: 800, height: 600 };
const win = (id: number, shown: boolean, state: CompositorWindow["state"] = "normal"): CompositorWindow => ({
  id,
  appId: "dev.dashi.activity-monitor",
  title: "Activity Monitor",
  pid: 1,
  focused: false,
  state,
  frame: shown ? frame : null,
  titleBar: 0,
});

test("a window off screen is suspended, and only changes are sent", () => {
  const told = new Map<number, boolean>([[2, true]]);
  const windows = [win(1, true), win(2, false, "minimized"), win(3, false), win(4, true)];
  // 1 and 4 are seen and were never told otherwise; 2 was told already; 3 is on another Desktop.
  expect(suspendChanges(windows, told)).toEqual([{ window: 3, on: true }]);
  told.set(4, true);
  expect(suspendChanges([win(4, true)], told)).toEqual([{ window: 4, on: false }]);
});

test("the shell tells windows as they go off screen and come back", async () => {
  let windows = [win(1, true), win(2, true)];
  const sent: unknown[] = [];
  const listeners: ((event: CompositorEvent) => void)[] = [];
  const request = async (method: string, params?: Record<string, unknown>) => {
    sent.push([method, params]);
    return {};
  };
  const extra = {
    windows: async () => windows,
    on: (listener: (event: CompositorEvent) => void) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    },
  };
  const stop = followSuspension(fakeCompositor(request, extra));
  const emit = async (event: CompositorEvent): Promise<void> => {
    for (const listener of listeners) listener(event);
    await flush();
  };
  await flush();
  expect(sent).toEqual([]);
  windows = [win(1, false, "minimized"), win(2, true)];
  await emit({ event: "window-state", window: 1, state: "minimized" });
  expect(sent).toEqual([["suspend", { window: 1, on: true }]]);
  windows = [win(1, true), win(2, false)];
  await emit({ event: "space", current: 1, previous: 0, count: 2 });
  expect(sent.slice(1)).toEqual([
    ["suspend", { window: 1, on: false }],
    ["suspend", { window: 2, on: true }],
  ]);
  // Events that say nothing about who is on screen are not looked at.
  await emit({ event: "shortcut", name: "launcher" });
  expect(sent).toHaveLength(3);
  stop();
});
