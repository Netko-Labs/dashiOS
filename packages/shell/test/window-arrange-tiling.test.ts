/**
 * Arranging a window with the square, Fill and the arrows chained, the person's drags and resizes, and
 * the events the compositor sends; a window's configuring and its least size.
 */

import { describe, expect, test } from "bun:test";
import { type CompositorWindow, parseEvent } from "../src/compositor.ts";
import { dragZones, keepLeast, type Rect, tileFrame } from "../src/layout.ts";
import { files, OWN, rect, SCREEN, started, USABLE } from "./support/window-arrange.ts";

describe("the square and Fill", () => {
  test("a click fills, telling the app it is maximized; a second click gives its own frame back", async () => {
    const { arranger, frames } = await started();
    await arranger.control(7, false);
    expect(arranger.arrangement(7)).toBe("fill");
    await arranger.control(7, false);
    expect(arranger.arrangement(7)).toBeNull();
    expect(frames()).toEqual([
      ["frame", { window: 7, ...USABLE, maximized: true }],
      ["frame", { window: 7, ...OWN }],
    ]);
  });

  test("a click on a tiled window gives its own frame back, not a smaller one (bug 1)", async () => {
    const { arranger, frames } = await started();
    await arranger.arrow(7, "left");
    await arranger.control(7, false);
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
  });

  test("⌥ and the square is full screen; on a full-screen window the square leaves it", async () => {
    const { arranger, frames, window } = await started();
    await arranger.control(7, true);
    expect(frames()).toEqual([["fullscreen", { window: 7, on: true }]]);
    expect(window.fullscreen).toBe(true);
    await arranger.control(7, false);
    expect(frames().slice(1)).toEqual([
      ["fullscreen", { window: 7, on: false }],
      ["frame", { window: 7, ...OWN }],
    ]);
  });

  test("the title bar's double-click does what the square does", async () => {
    const { emit, frames, arranger } = await started();
    await emit({ event: "window-control", window: 7, control: "zoom", alt: false, double: true });
    expect(arranger.arrangement(7)).toBe("fill");
    expect(frames()).toEqual([["frame", { window: 7, ...USABLE, maximized: true }]]);
  });

  test("an app's own maximize fills, and unmaximize goes back", async () => {
    const { emit, frames } = await started();
    await emit({ event: "zoom", window: 7, on: true });
    await emit({ event: "zoom", window: 7, on: false });
    expect(frames()).toEqual([
      ["frame", { window: 7, ...USABLE, maximized: true }],
      ["frame", { window: 7, ...OWN }],
    ]);
  });
});

describe("chaining the arrows", () => {
  test("left, then up is the top-left quarter; back goes to the frame from before the first", async () => {
    const { arranger, frames } = await started();
    await arranger.arrow(7, "left");
    await arranger.arrow(7, "up");
    expect(arranger.arrangement(7)).toBe("top-left");
    await arranger.arrange(7, "restore");
    expect(frames()).toEqual([
      ["frame", { window: 7, ...rect(6, 34, 814, 826), tiled: true }],
      ["frame", { window: 7, ...rect(6, 34, 814, 410), tiled: true }],
      ["frame", { window: 7, ...OWN }],
    ]);
  });

  test("the opposite arrow from a half is its own size; the same arrow on one screen does nothing", async () => {
    const { arranger, frames } = await started();
    await arranger.arrow(7, "left");
    await arranger.arrow(7, "left");
    expect(frames()).toHaveLength(1);
    await arranger.arrow(7, "right");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
    expect(arranger.arrangement(7)).toBeNull();
  });

  test("the same arrow again moves the half to the next screen, and back is on that screen", async () => {
    const second = { name: "HDMI-A-1", frame: rect(1646, 0, 1920, 1080), usable: rect(1646, 28, 1920, 1052) };
    const { arranger, frames } = await started(files(), [{ name: "Virtual-1", frame: SCREEN, usable: USABLE }, second]);
    await arranger.arrow(7, "right");
    await arranger.arrow(7, "right");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...tileFrame("right", second.usable), tiled: true }]);
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(1946, 200, 800, 600) }]);
  });

  test("Center puts its own size in the middle and ends the arrangement", async () => {
    const { arranger, frames } = await started();
    await arranger.arrange(7, "fill");
    await arranger.arrange(7, "center");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(423, 147, 800, 600) }]);
    expect(arranger.arrangement(7)).toBeNull();
  });

  test("back with nothing to go back to does nothing", async () => {
    const { arranger, frames } = await started();
    await arranger.arrange(7, "restore");
    expect(frames()).toEqual([]);
  });

  test("a full-screen window is not tiled", async () => {
    const window = { ...files(), fullscreen: true };
    const { arranger, frames } = await started(window);
    await arranger.arrow(7, "left");
    await arranger.arrange(7, "fill");
    expect(frames()).toEqual([]);
  });
});

describe("the person's drags and resizes", () => {
  test("dragging a tiled window gives its own size back under the pointer, and forgets the tile (bug 2)", async () => {
    const { arranger, emit, frames } = await started();
    await arranger.arrow(7, "left");
    await emit({ event: "window-grab", window: 7, kind: "move", frame: rect(6, 34, 814, 826), pointer: { x: 413, y: 44 } });
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(13, 34, 800, 600) }]);
    expect(arranger.arrangement(7)).toBeNull();
  });

  test("a resize by the person forgets the arrangement, and asks nothing", async () => {
    const { arranger, emit, frames } = await started();
    await arranger.arrange(7, "fill");
    await emit({ event: "window-grab", window: 7, kind: "resize", frame: USABLE, pointer: { x: 1646, y: 400 } });
    expect(arranger.arrangement(7)).toBeNull();
    expect(frames()).toHaveLength(1);
  });

  test("a drop on the menu bar fills; back is where the drag began", async () => {
    const { arranger, emit, frames, window } = await started();
    await emit({ event: "window-grab", window: 7, kind: "move", frame: { ...OWN }, pointer: { x: 500, y: 210 } });
    window.frame = rect(400, 20, 800, 600);
    const zone = dragZones({ name: "Virtual-1", frame: SCREEN, usable: USABLE, scale: 1 }).findIndex((each) => each.tile === "fill");
    await emit({ event: "window-drop", window: 7, zone, frame: USABLE });
    expect(arranger.arrangement(7)).toBe("fill");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...USABLE, maximized: true }]);
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
  });

  test("a drop naming a zone that has changed is ignored", async () => {
    const { arranger, emit, frames } = await started();
    await emit({ event: "window-drop", window: 7, zone: 0, frame: rect(1, 2, 3, 4) });
    expect(arranger.arrangement(7)).toBeNull();
    expect(frames()).toEqual([]);
  });

  test("a closed window is forgotten", async () => {
    const { arranger, emit } = await started();
    await arranger.arrange(7, "left");
    await emit({ event: "window-closed", id: 7 });
    expect(arranger.arrangement(7)).toBeNull();
  });
});

describe("the events", () => {
  test("window-control, window-grab, and window-drop are parsed; bad ones are not", () => {
    expect(parseEvent({ event: "window-control", window: 3, control: "zoom", alt: true, double: false })).toEqual({
      event: "window-control",
      window: 3,
      control: "zoom",
      alt: true,
      double: false,
    });
    expect(parseEvent({ event: "window-control", window: 3, control: "close" })).toBeNull();
    expect(parseEvent({ event: "window-grab", window: 3, kind: "move", frame: { x: 1, y: 2, width: 3, height: 4 }, pointer: { x: 5, y: 6 } })).toEqual({
      event: "window-grab",
      window: 3,
      kind: "move",
      frame: { x: 1, y: 2, width: 3, height: 4 },
      pointer: { x: 5, y: 6 },
    });
    expect(parseEvent({ event: "window-grab", window: 3, kind: "spin", frame: { x: 1, y: 2, width: 3, height: 4 }, pointer: { x: 5, y: 6 } })).toBeNull();
    expect(parseEvent({ event: "window-drop", window: 3, zone: 2, frame: { x: 1, y: 2, width: 3, height: 4 } })).toEqual({
      event: "window-drop",
      window: 3,
      zone: 2,
      frame: { x: 1, y: 2, width: 3, height: 4 },
    });
    expect(parseEvent({ event: "window-drop", window: 3, zone: -1, frame: { x: 1, y: 2, width: 3, height: 4 } })).toBeNull();
    expect(parseEvent({ event: "zoom", window: 3, on: false })).toEqual({ event: "zoom", window: 3, on: false });
    expect(parseEvent({ event: "zoom", window: 3 })).toEqual({ event: "zoom", window: 3 });
  });
});

describe("configuring", () => {
  test("a window says the size it is being asked to take, only while its app has not drawn it", () => {
    const base = { id: 3, appId: "foot", title: "foot", pid: 42, focused: true, state: "normal" };
    expect(parseEvent({ event: "window-opened", window: { ...base, configuring: { width: 760, height: 508 } } })).toMatchObject({
      window: { configuring: { width: 760, height: 508 } },
    });
    expect(parseEvent({ event: "window-opened", window: { ...base, configuring: null } })).not.toHaveProperty("window.configuring");
    expect(parseEvent({ event: "window-opened", window: { ...base, configuring: { width: 0, height: 5 } } })).not.toHaveProperty("window.configuring");
  });
});

describe("an app's least size", () => {
  const SettingsLeast = { width: 744, height: 300 };
  const settings = (): CompositorWindow => ({ ...files(), id: 9, appId: "dev.dashi.settings", title: "System Settings", minSize: { ...SettingsLeast } });

  test("a window says the least frame its app allows", () => {
    const base = { id: 3, appId: "dev.dashi.settings", title: "System Settings", pid: 42, focused: true, state: "normal" };
    expect(parseEvent({ event: "window-opened", window: { ...base, minSize: { width: 744, height: 300 } } })).toMatchObject({
      window: { minSize: { width: 744, height: 300 } },
    });
    expect(parseEvent({ event: "window-opened", window: { ...base, minSize: null } })).not.toHaveProperty("window.minSize");
  });

  test("a frame grows to it away from the screen's edge, and stays inside the usable area", () => {
    const left = tileFrame("left", USABLE);
    expect(keepLeast(left, { width: 1000, height: 300 }, USABLE)).toEqual({ ...left, width: 1000 });
    const right = tileFrame("right", USABLE);
    expect(keepLeast(right, { width: 1000, height: 300 }, USABLE)).toEqual({ ...right, x: right.x + right.width - 1000, width: 1000 });
    const bottom = tileFrame("bottom-right", USABLE);
    const kept = keepLeast(bottom, { width: 300, height: 600 }, USABLE);
    expect(kept.y + kept.height).toBe(bottom.y + bottom.height);
    expect(kept.height).toBe(600);
    // Bigger than the screen: as big as the usable area.
    expect(keepLeast(left, { width: 5000, height: 5000 }, USABLE)).toEqual(USABLE);
    // Already big enough, or no least size: unchanged.
    expect(keepLeast(left, { width: 100, height: 100 }, USABLE)).toBe(left);
    expect(keepLeast(left, undefined, USABLE)).toBe(left);
  });

  test("a half of a small screen too narrow for System Settings takes its least width", async () => {
    const small = { x: 0, y: 28, width: 1097, height: 620 };
    const { arranger, frames } = await started(settings(), [{ name: "Virtual-1", frame: { x: 0, y: 0, width: 1097, height: 686 }, usable: small }]);
    await arranger.arrow(9, "right");
    const asked = frames().at(-1)?.[1] as unknown as Rect & { tiled?: boolean };
    expect(asked.width).toBe(SettingsLeast.width);
    expect(asked.x + asked.width).toBe(tileFrame("right", small).x + tileFrame("right", small).width);
    expect(asked.tiled).toBe(true);
  });
});
