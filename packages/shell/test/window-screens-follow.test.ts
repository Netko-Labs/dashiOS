/**
 * Every window follows its screen, on every Desktop (arrange/lib/screens-gone.ts, decisions.md D537):
 * a screen that moves in the arrangement, changes its size or scale, or gets its menu bar takes its
 * windows along, the ones waiting on a Desktop that isn't showing as well as the ones that show; a
 * window its screen has no room for gets its own size back when there is room again, and its memory
 * keeps that size, not the one a screen still settling gave it. The VM's installed pass found each of
 * these wrong (dashi-0.10.0-review/04-screens-installed, bugs 1 to 3).
 */

import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange/arrange.ts";
import { MemoryFile } from "../src/arrange/lib/memory-file.ts";
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

/** The window goes to another Desktop, which does not show: where it was is where it waits. */
const hide = (each: CompositorWindow): void => {
  each.away = each.frame ?? undefined;
  each.frame = null;
  each.space = 2;
};

async function screens(windows: CompositorWindow[], memory: MemoryFile | null = null) {
  const outputs = [{ ...FIRST }, { ...SECOND }];
  const world = fake(windows, outputs);
  const arranger = new Arranger(world.compositor, memory);
  await arranger.start();
  world.requests.length = 0;
  /** The screens become `next`, and the compositor says so. */
  const become = async (...next: Array<{ name: string; frame: Rect; usable: Rect }>) => {
    outputs.splice(0, outputs.length, ...next);
    world.requests.length = 0;
    await world.emit({ event: "outputs-changed" });
  };
  const asked = () => world.requests.filter(([method]) => method === "frame" || method === "fullscreen");
  return { ...world, arranger, become, asked };
}

describe("bug 1: a tile on a Desktop that isn't showing", () => {
  test("it takes its tile on the screen it lands on, and again when that screen's bar arrives", async () => {
    const calendar = window(1, rect(1746, 100, 800, 600));
    const world = await screens([calendar]);
    await world.arranger.arrow(1, "right");
    hide(calendar);
    await world.become({ ...FIRST });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 826, y: 34, width: 814, height: 826, tiled: true }]]);
    // Plugged back: no bar on it yet, so its usable area is all of it (the tile at y 6, under where the bar comes).
    await world.become({ ...FIRST }, { ...SECOND, usable: SECOND.frame });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 2609, y: 6, width: 951, height: 1068, tiled: true }]]);
    await world.become({ ...FIRST }, { ...SECOND });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 2609, y: 34, width: 951, height: 969, tiled: true }]]);
    expect(calendar.away).toEqual(rect(2609, 34, 951, 969));
  });

  test("it follows its screen's usable area when the Dock comes there", async () => {
    const calendar = window(1, rect(100, 100, 800, 600));
    const world = await screens([calendar]);
    await world.arranger.arrow(1, "left");
    hide(calendar);
    await world.become({ ...FIRST, usable: rect(0, 28, 1646, 760) }, { ...SECOND });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 6, y: 34, width: 814, height: 748, tiled: true }]]);
  });
});

describe("bug 2: windows on hidden Desktops follow a screen that moves or changes scale", () => {
  test("a screen moved in the arrangement takes its windows along, shown and hidden", async () => {
    const shown = window(1, rect(1746, 100, 800, 600));
    const hidden = window(2, rect(2000, 300, 500, 400));
    const world = await screens([shown, hidden]);
    hide(hidden);
    // Screen 2 goes to the left of screen 1.
    await world.become({ ...FIRST }, { ...SECOND, frame: rect(-1920, 0, 1920, 1080), usable: rect(-1920, 28, 1920, 981) });
    expect(world.asked()).toEqual([
      ["frame", { window: 1, x: -1820, y: 100, width: 800, height: 600 }],
      ["frame", { window: 2, x: -1566, y: 300, width: 500, height: 400 }],
    ]);
  });

  test("a screen that shrinks (its scale grew) pulls a hidden window in, and refits a full-screen one", async () => {
    const files = window(1, rect(3000, 200, 500, 400));
    const terminal = window(2, rect(1646, 0, 1920, 1080), { fullscreen: true });
    const world = await screens([files, terminal]);
    hide(files);
    hide(terminal);
    await world.become({ ...FIRST }, { ...SECOND, frame: rect(1646, 0, 1536, 864), usable: rect(1646, 28, 1536, 765) });
    expect(world.asked()).toEqual([
      ["frame", { window: 1, x: 2682, y: 200, width: 500, height: 400 }],
      ["fullscreen", { window: 2, on: false }],
      ["frame", { window: 2, x: 1646, y: 28, width: 1536, height: 765 }],
      ["fullscreen", { window: 2, on: true }],
    ]);
  });

  test("a window shrunk to fit gets its own size back when its screen has room again", async () => {
    const notes = window(1, rect(1700, 100, 1800, 900));
    const world = await screens([notes]);
    hide(notes);
    await world.become({ ...FIRST }, { ...SECOND, frame: rect(1646, 0, 1536, 864), usable: rect(1646, 28, 1536, 765) });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 1646, y: 28, width: 1536, height: 765 }]]);
    await world.become({ ...FIRST }, { ...SECOND });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 1700, y: 100, width: 1800, height: 900 }]]);
  });
});

describe("bug 3: a screen that comes back small, then settles", () => {
  test("a window back on it gets its own frame once the screen has its size; closed meanwhile, its memory keeps that frame", async () => {
    const memory = new MemoryFile(null);
    const notes = window(1, rect(44, 46, 980, 640), { appId: "dev.dashi.notes" });
    const world = await screens([notes], memory);
    await world.emit({ event: "window-placing", window: { id: 1, appId: "dev.dashi.notes", title: "Notes", width: 980, height: 640 } });
    await world.become({ ...SECOND });
    // Back at its EDID-less 640 × 480 first.
    await world.become({ ...FIRST, frame: rect(0, 0, 640, 480), usable: rect(0, 28, 640, 400) }, { ...SECOND });
    expect(notes.frame).toEqual(rect(0, 28, 640, 400));
    await world.emit({ event: "window-closed", id: 1, frame: rect(0, 28, 640, 400) });
    expect(memory.get("dev.dashi.notes")).toMatchObject({ frame: rect(44, 46, 980, 640) });
  });

  test("the screen grows to its mode: the window is back at its own frame", async () => {
    const notes = window(1, rect(44, 46, 980, 640));
    const world = await screens([notes]);
    await world.become({ ...SECOND });
    await world.become({ ...FIRST, frame: rect(0, 0, 640, 480), usable: rect(0, 28, 640, 400) }, { ...SECOND });
    await world.become({ ...FIRST }, { ...SECOND });
    expect(world.asked()).toEqual([["frame", { window: 1, x: 44, y: 46, width: 980, height: 640 }]]);
  });
});
