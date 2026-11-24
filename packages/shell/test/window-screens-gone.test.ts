/**
 * A screen unplugged and plugged back (arrange/lib/screens-gone.ts, decisions.md D533): every window on
 * it lands inside the screen left (the ones that show, the minimized, the ones on another Desktop, the
 * full-screen ones), and goes back where it was when the screen returns, unless the person moved it.
 */

import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange/arrange.ts";
import { nearestScreen, screensMissing, whereItIs } from "../src/arrange/lib/screens-gone.ts";
import type { CompositorWindow } from "../src/compositor/index.ts";
import type { Rect } from "../src/layout.ts";
import { fake, rect, SCREEN, USABLE } from "./support/window-arrange.ts";

const FIRST = { name: "Virtual-1", frame: SCREEN, usable: USABLE };
const SECOND = { name: "Virtual-2", frame: rect(1646, 0, 1920, 1080), usable: rect(1646, 28, 1920, 981) };

const window = (id: number, frame: Rect | null, fields: Partial<CompositorWindow> = {}): CompositorWindow => ({
  id,
  appId: `app.${id}`,
  title: "",
  pid: 9,
  focused: false,
  state: "normal",
  frame,
  titleBar: 0,
  ...fields,
});

async function twoScreens(windows: CompositorWindow[]) {
  const outputs = [FIRST, SECOND];
  const world = fake(windows, outputs);
  const arranger = new Arranger(world.compositor);
  await arranger.start();
  world.requests.length = 0;
  const unplug = async () => {
    outputs.splice(1, 1);
    await world.emit({ event: "outputs-changed" });
  };
  const replug = async () => {
    outputs.push(SECOND);
    await world.emit({ event: "outputs-changed" });
  };
  const asked = () => world.requests.filter(([method]) => method === "frame" || method === "fullscreen");
  return { ...world, arranger, unplug, replug, asked };
}

describe("the pieces", () => {
  test("a screen is missing by its identity; the nearest left takes its windows", () => {
    const first = { ...FIRST, scale: 1, identity: "port:Virtual-1" };
    const second = { ...SECOND, scale: 1, identity: "port:Virtual-2" };
    expect(screensMissing([first, second], [first])).toEqual([second]);
    // The same screen on another port is the same screen.
    expect(screensMissing([second], [{ ...second, name: "DP-3" }])).toEqual([]);
    expect(nearestScreen(second, [first])).toBe(first);
  });

  test("where a window is: on screen, on another Desktop, or where it comes back from the Dock", () => {
    expect(whereItIs(window(1, rect(1, 2, 3, 4)))).toEqual(rect(1, 2, 3, 4));
    expect(whereItIs(window(1, null, { away: rect(5, 6, 7, 8) }))).toEqual(rect(5, 6, 7, 8));
    expect(whereItIs(window(1, null, { state: "minimized", parked: rect(9, 9, 9, 9) }))).toEqual(rect(9, 9, 9, 9));
  });
});

describe("unplugged and plugged back", () => {
  test("a window on the screen that went keeps its place on the one left, inside it, and goes back after", async () => {
    const world = await twoScreens([window(1, rect(1746, 100, 800, 600))]);
    await world.unplug();
    expect(world.asked()).toEqual([["frame", { window: 1, x: 100, y: 100, width: 800, height: 600 }]]);
    world.requests.length = 0;
    await world.replug();
    expect(world.asked()).toEqual([["frame", { window: 1, x: 1746, y: 100, width: 800, height: 600 }]]);
  });

  test("minimized windows and windows on another Desktop are moved too, not lost where the screen was", async () => {
    const world = await twoScreens([
      window(1, null, { state: "minimized", parked: rect(2000, 300, 640, 480) }),
      window(2, null, { away: rect(3000, 200, 500, 400), space: 1 }),
    ]);
    await world.unplug();
    expect(world.asked()).toEqual([
      ["frame", { window: 1, x: 354, y: 300, width: 640, height: 480 }],
      ["frame", { window: 2, x: 1146, y: 200, width: 500, height: 400 }],
    ]);
  });

  test("a full-screen window is full screen on the screen left", async () => {
    const world = await twoScreens([window(1, rect(1646, 0, 1920, 1080), { fullscreen: true })]);
    await world.unplug();
    expect(world.asked()).toEqual([
      ["fullscreen", { window: 1, on: false }],
      ["frame", { window: 1, x: 0, y: 28, width: 1646, height: 838 }],
      ["fullscreen", { window: 1, on: true }],
    ]);
  });

  test("a tiled window takes its tile on the screen left, and back", async () => {
    const world = await twoScreens([window(1, rect(1746, 100, 800, 600))]);
    await world.arranger.arrow(1, "left");
    world.requests.length = 0;
    await world.unplug();
    expect(world.asked()).toEqual([["frame", { window: 1, x: 6, y: 34, width: 814, height: 826, tiled: true }]]);
    world.requests.length = 0;
    await world.replug();
    expect(world.asked()).toEqual([["frame", { window: 1, x: 1652, y: 34, width: 951, height: 969, tiled: true }]]);
  });

  test("moved by the person meanwhile, it stays where they put it", async () => {
    const world = await twoScreens([window(1, rect(1746, 100, 800, 600))]);
    await world.unplug();
    await world.emit({ event: "window-grab", window: 1, kind: "move", frame: rect(100, 100, 800, 600), pointer: { x: 300, y: 110 } });
    world.requests.length = 0;
    await world.replug();
    expect(world.asked()).toEqual([]);
  });
});
