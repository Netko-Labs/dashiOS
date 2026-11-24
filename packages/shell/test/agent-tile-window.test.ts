/**
 * tile_window says what happened: a window that can't take a tile (minimized,
 * hidden, full screen) is an error saying why, never "is arranged" for nothing
 * (the installed pass of 24 Nov, 22-fix-installed; decisions.md D699).
 */

import { expect, test } from "bun:test";
import type { RunContext } from "../src/agents/context.ts";
import { windowHandlers } from "../src/agents/lib/run/run-windows.ts";
import type { CompositorWindow } from "../src/compositor/index.ts";

const NOTES: CompositorWindow = { id: 25, appId: "dev.dashi.notes", title: "Notes", pid: 9, focused: false, state: "normal", frame: null, titleBar: 0 };

function context(window: CompositorWindow, tiled: number[]): RunContext {
  return {
    compositor: { windows: async () => [window] },
    status: () => {},
    mayName: () => false,
    tile: async (id: number) => void tiled.push(id),
  } as unknown as RunContext;
}

const tile = (window: CompositorWindow, tiled: number[]) => windowHandlers.tile_window({ name: "tile_window", window: window.id, tile: "left" }, context(window, tiled));

test("a window waiting on another Desktop is arranged there", async () => {
  const tiled: number[] = [];
  const result = await tile({ ...NOTES, away: { x: 44, y: 28, width: 980, height: 640 }, space: 2 }, tiled);
  expect(result.isError).toBeUndefined();
  expect(tiled).toEqual([25]);
});

test("a minimized or hidden window is not arranged, and the agent is told why", async () => {
  for (const state of ["minimized", "hidden"] as const) {
    const tiled: number[] = [];
    const result = await tile({ ...NOTES, state }, tiled);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({ type: "text", text: `w25 is ${state}: bring it back first (focus_window), then arrange it.` });
    expect(tiled).toEqual([]);
  }
});

test("a full-screen window is not arranged, and the agent is told why", async () => {
  const tiled: number[] = [];
  const result = await tile({ ...NOTES, frame: { x: 0, y: 0, width: 1097, height: 686 }, fullscreen: true }, tiled);
  expect(result.isError).toBe(true);
  expect(tiled).toEqual([]);
});
