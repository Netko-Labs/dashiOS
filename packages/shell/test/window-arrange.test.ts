import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange.ts";
import { type Compositor, type CompositorEvent, type CompositorWindow, parseEvent } from "../src/compositor.ts";
import { carryFrame, centerFrame, dragZones, frameUnderPointer, type Rect, TILES, tileFrame } from "../src/layout.ts";
import { arrowStep, screenToward } from "../src/tiling.ts";

/** The VM's screen: 1646 × 937 points, the menu bar (28) and the Dock (65 + 6) leaving 838 between them. */
const SCREEN: Rect = { x: 0, y: 0, width: 1646, height: 937 };
const USABLE: Rect = { x: 0, y: 28, width: 1646, height: 838 };
const rect = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });

describe("tile frames", () => {
  test("halves and quarters keep a 6-point gap; Fill is the whole usable area", () => {
    expect(tileFrame("fill", USABLE)).toEqual(USABLE);
    expect(tileFrame("left", USABLE)).toEqual(rect(6, 34, 814, 826));
    expect(tileFrame("right", USABLE)).toEqual(rect(826, 34, 814, 826));
    expect(tileFrame("top", USABLE)).toEqual(rect(6, 34, 1634, 410));
    expect(tileFrame("bottom", USABLE)).toEqual(rect(6, 450, 1634, 410));
    expect(tileFrame("top-left", USABLE)).toEqual(rect(6, 34, 814, 410));
    expect(tileFrame("top-right", USABLE)).toEqual(rect(826, 34, 814, 410));
    expect(tileFrame("bottom-left", USABLE)).toEqual(rect(6, 450, 814, 410));
    expect(tileFrame("bottom-right", USABLE)).toEqual(rect(826, 450, 814, 410));
  });

  test("every tile stays inside the usable area", () => {
    for (const tile of TILES) {
      const frame = tileFrame(tile, USABLE);
      expect(frame.x).toBeGreaterThanOrEqual(USABLE.x);
      expect(frame.y).toBeGreaterThanOrEqual(USABLE.y);
      expect(frame.x + frame.width).toBeLessThanOrEqual(USABLE.x + USABLE.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(USABLE.y + USABLE.height);
    }
  });

  test("Center keeps the size, centered, and shrinks only what does not fit", () => {
    expect(centerFrame({ width: 800, height: 600 }, USABLE)).toEqual(rect(423, 147, 800, 600));
    expect(centerFrame({ width: 2000, height: 600 }, USABLE)).toEqual(rect(0, 147, 1646, 600));
  });

  test("dragged out of a tile, the window keeps the pressed point under the pointer", () => {
    // Pressed at the middle of a left half's title bar: the own size is centered on the pointer.
    expect(frameUnderPointer(rect(6, 34, 814, 826), { width: 600, height: 400 }, { x: 413, y: 44 })).toEqual(rect(113, 34, 600, 400));
    // Pressed near Fill's left end: the window's left end stays near the pointer.
    expect(frameUnderPointer(rect(0, 28, 1646, 838), { width: 600, height: 400 }, { x: 100, y: 40 })).toEqual(rect(64, 28, 600, 400));
  });

  test("a frame carried to another screen keeps its place there", () => {
    const second = rect(1646, 0, 1280, 800);
    expect(carryFrame(rect(100, 100, 800, 600), USABLE, second)).toEqual(rect(1746, 72, 800, 600));
    // Too big for the smaller screen: shrunk to fit.
    expect(carryFrame(rect(100, 100, 1500, 600), USABLE, second).width).toBe(1280);
  });

  test("drag zones: corners give quarters, sides halves, the menu bar Fill", () => {
    const zones = dragZones({ name: "Virtual-1", frame: SCREEN, usable: USABLE, scale: 1 });
    expect(zones.map((zone) => zone.tile)).toEqual(["top-left", "bottom-left", "left", "top-right", "bottom-right", "right", "fill"]);
    expect(zones.find((zone) => zone.tile === "fill")?.frame).toEqual(USABLE);
  });
});

describe("the ⌃❖ arrows", () => {
  test("from its own frame or Fill, an arrow is the half on that side", () => {
    expect(arrowStep(null, "left")).toEqual({ kind: "tile", tile: "left" });
    expect(arrowStep(null, "up")).toEqual({ kind: "tile", tile: "top" });
    expect(arrowStep("fill", "down")).toEqual({ kind: "tile", tile: "bottom" });
    expect(arrowStep("fill", "right")).toEqual({ kind: "tile", tile: "right" });
  });

  test("from a half: at right angles a quarter, the opposite way back, the same way the next screen", () => {
    expect(arrowStep("left", "up")).toEqual({ kind: "tile", tile: "top-left" });
    expect(arrowStep("left", "down")).toEqual({ kind: "tile", tile: "bottom-left" });
    expect(arrowStep("right", "up")).toEqual({ kind: "tile", tile: "top-right" });
    expect(arrowStep("top", "left")).toEqual({ kind: "tile", tile: "top-left" });
    expect(arrowStep("bottom", "right")).toEqual({ kind: "tile", tile: "bottom-right" });
    expect(arrowStep("left", "right")).toEqual({ kind: "restore" });
    expect(arrowStep("top", "down")).toEqual({ kind: "restore" });
    expect(arrowStep("left", "left")).toEqual({ kind: "next-screen", tile: "left" });
    expect(arrowStep("bottom", "down")).toEqual({ kind: "next-screen", tile: "bottom" });
  });

  test("from a quarter: to the neighbouring quarter, or past the edge to the next screen", () => {
    expect(arrowStep("top-left", "right")).toEqual({ kind: "tile", tile: "top-right" });
    expect(arrowStep("top-left", "down")).toEqual({ kind: "tile", tile: "bottom-left" });
    expect(arrowStep("bottom-right", "up")).toEqual({ kind: "tile", tile: "top-right" });
    expect(arrowStep("top-left", "left")).toEqual({ kind: "next-screen", tile: "top-left" });
    expect(arrowStep("top-left", "up")).toEqual({ kind: "next-screen", tile: "top-left" });
  });

  test("the next screen is the nearest wholly on that side; none past the last", () => {
    const left = { name: "a", frame: rect(-1280, 0, 1280, 800) };
    const middle = { name: "b", frame: SCREEN };
    const right = { name: "c", frame: rect(1646, 0, 1920, 1080) };
    const farRight = { name: "d", frame: rect(3566, 0, 1920, 1080) };
    const screens = [left, middle, right, farRight];
    expect(screenToward(SCREEN, screens, "left")).toBe(left);
    expect(screenToward(SCREEN, screens, "right")).toBe(right);
    expect(screenToward(SCREEN, screens, "up")).toBeNull();
    expect(screenToward(SCREEN, [middle], "right")).toBeNull();
  });
});

/**
 * A compositor holding `windows`, carrying out `frame` and `fullscreen`, and
 * keeping what it was asked. As dashi-comp does, full screen says
 * `outputs-changed` while it is asked; leaving, the app still draws at the
 * screen's size for a while (where its old frame was), and `configuring`
 * says the size it was asked to take. With `lag`, an app is slow as a busy
 * Metal app is: a frame moves the window at once, but its size changes only
 * at `catchUp()`, and until then `configuring` says what it will be.
 */
function fake(
  windows: Array<CompositorWindow & { away?: Rect | null }>,
  outputs: Array<{ name: string; frame: Rect; usable: Rect }> = [{ name: "Virtual-1", frame: SCREEN, usable: USABLE }],
  lag = false,
) {
  const requests: Array<[string, Record<string, unknown>]> = [];
  let listener: ((event: CompositorEvent) => void) | null = null;
  const compositor = {
    on: (each: (event: CompositorEvent) => void) => {
      listener = each;
      return () => {
        listener = null;
      };
    },
    request: async (method: string, params: Record<string, unknown> = {}) => {
      requests.push([method, params]);
      if (method === "outputs") return { outputs: outputs.map((output) => ({ ...output, scale: 1 })) };
      const window = windows.find((candidate) => candidate.id === params.window);
      if (window && method === "frame") {
        const size = { width: Number(params.width), height: Number(params.height) };
        const drawn = lag && window.frame ? { width: window.frame.width, height: window.frame.height } : size;
        window.frame = { x: Number(params.x), y: Number(params.y), ...drawn };
        if (lag) window.configuring = size;
        else delete window.configuring;
      }
      if (window && method === "fullscreen") {
        const on = params.on === true;
        if (on) window.away = window.frame;
        window.fullscreen = on;
        window.frame = on ? { ...SCREEN } : { x: window.away?.x ?? 0, y: window.away?.y ?? 0, width: SCREEN.width, height: SCREEN.height };
        if (on) delete window.configuring;
        else if (window.away) window.configuring = { width: window.away.width, height: window.away.height };
        listener?.({ event: "outputs-changed" });
      }
      return {};
    },
    windows: async () => windows.map(({ away: _, ...window }) => ({ ...window })),
  } as unknown as Compositor;
  const frames = () => requests.filter(([method]) => method === "frame" || method === "fullscreen");
  const emit = async (event: CompositorEvent) => {
    listener?.(event);
    for (let tick = 0; tick < 5; tick++) await new Promise((done) => setTimeout(done, 0));
  };
  /** The apps draw at the sizes they were asked for. */
  const catchUp = () => {
    for (const window of windows) {
      if (window.configuring && window.frame) window.frame = { ...window.frame, ...window.configuring };
      delete window.configuring;
    }
  };
  return { compositor, requests, frames, emit, catchUp };
}

const OWN = rect(300, 200, 800, 600);
const files = (): CompositorWindow => ({
  id: 7,
  appId: "dev.dashi.files",
  title: "Files",
  pid: 9,
  focused: true,
  state: "normal",
  frame: { ...OWN },
  titleBar: 0,
});

async function started(window = files(), outputs?: Parameters<typeof fake>[1], lag = false) {
  const world = fake([window], outputs, lag);
  const arranger = new Arranger(world.compositor);
  await arranger.start();
  world.requests.length = 0;
  return { ...world, arranger, window };
}

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
      ["frame", { window: 7, ...rect(6, 34, 814, 826) }],
      ["frame", { window: 7, ...rect(6, 34, 814, 410) }],
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
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...tileFrame("right", second.usable) }]);
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

describe("full screen and back", () => {
  const settle = () => new Promise((done) => setTimeout(done, 20));

  test("leaving gives back the frame from before, and the screens unchanged fit nothing", async () => {
    const { arranger, frames, window } = await started();
    await arranger.control(7, true);
    await arranger.toggleFullscreen(7);
    await settle();
    expect(frames()).toEqual([
      ["fullscreen", { window: 7, on: true }],
      ["fullscreen", { window: 7, on: false }],
      ["frame", { window: 7, ...OWN }],
    ]);
    expect(window.frame).toEqual(OWN);
    expect(arranger.arrangement(7)).toBeNull();
    // Its own frame is still its own: Fill, then back, is the frame from before.
    await arranger.arrange(7, "fill");
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
  });

  test("a tiled or filled window comes back tiled or filled", async () => {
    const { arranger, frames } = await started();
    await arranger.arrow(7, "left");
    await arranger.toggleFullscreen(7);
    await arranger.toggleFullscreen(7);
    await settle();
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...tileFrame("left", USABLE) }]);
    expect(arranger.arrangement(7)).toBe("left");
    await arranger.arrange(7, "fill");
    await arranger.toggleFullscreen(7);
    await arranger.toggleFullscreen(7);
    await settle();
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...USABLE, maximized: true }]);
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
  });

  test("Fill, Center, then full screen twice: centered again, not maximized", async () => {
    const { arranger, frames } = await started();
    await arranger.arrange(7, "fill");
    await arranger.arrange(7, "center");
    await arranger.toggleFullscreen(7);
    await arranger.toggleFullscreen(7);
    await settle();
    const centered = rect(423, 147, 800, 600);
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...centered }]);
    // Only Fill tells the app it is maximized: Center and Back do not.
    expect(frames().filter(([, params]) => params.maximized === true)).toHaveLength(1);
  });

  test("when the screens do change just after, the frame given back is what is fitted, not the full-screen size", async () => {
    const outputs = [{ name: "Virtual-1", frame: SCREEN, usable: USABLE }];
    const window = files();
    const world = fake([window], outputs);
    const arranger = new Arranger(world.compositor);
    await arranger.start();
    await arranger.toggleFullscreen(7);
    await arranger.toggleFullscreen(7);
    await settle();
    world.requests.length = 0;
    // The Dock comes back meanwhile, and the app has not yet taken its frame back: it reports the screen's size.
    window.frame = { x: OWN.x, y: OWN.y, width: SCREEN.width, height: SCREEN.height };
    window.configuring = { width: OWN.width, height: OWN.height };
    outputs[0] = { ...outputs[0], usable: rect(0, 28, 1646, 800) } as (typeof outputs)[number];
    await world.emit({ event: "outputs-changed" });
    // It was asked for its own frame, which still fits: nothing to send, and nothing at the full-screen size.
    expect(world.frames()).toEqual([]);
  });
});

describe("a slow app: the size asked for counts until it is drawn", () => {
  const lagging = () => started(files(), undefined, true);
  const centered = rect(423, 147, 800, 600);

  test("back, then at once a tile: the frame to go back to is its own, not the last tile's", async () => {
    const { arranger, frames, catchUp, window } = await lagging();
    await arranger.arrow(7, "up");
    catchUp();
    await arranger.arrange(7, "restore");
    // The app still draws the top half, where its own frame is.
    expect(window.frame).toEqual(rect(300, 200, 1634, 410));
    await arranger.arrow(7, "down");
    catchUp();
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
  });

  test("back, then at once Center: its own size, centered", async () => {
    const { arranger, frames, catchUp } = await lagging();
    await arranger.arrow(7, "up");
    catchUp();
    await arranger.arrange(7, "restore");
    await arranger.arrange(7, "center");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...centered }]);
  });

  test("back, a tile, Fill, then Center (the VM's steps): its own size, centered", async () => {
    const { arranger, frames, catchUp } = await lagging();
    await arranger.arrow(7, "up");
    catchUp();
    await arranger.arrange(7, "restore");
    await arranger.arrow(7, "down");
    await arranger.arrange(7, "fill");
    await arranger.arrange(7, "center");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...centered }]);
    catchUp();
    await arranger.arrange(7, "fill");
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...centered }]);
  });

  test("dragged out of a tile, then tiled again before it is drawn: back is its own size", async () => {
    const { arranger, emit, frames, catchUp, window } = await lagging();
    await arranger.arrow(7, "up");
    catchUp();
    await arranger.arrange(7, "restore");
    await arranger.arrow(7, "left");
    catchUp();
    await emit({ event: "window-grab", window: 7, kind: "move", frame: rect(6, 34, 814, 826), pointer: { x: 413, y: 44 } });
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(13, 34, 800, 600) }]);
    // The person drags it on; the app still draws the left half's size.
    window.frame = rect(500, 200, 814, 826);
    await arranger.arrow(7, "right");
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(500, 200, 800, 600) }]);
  });

  test("out of full screen, then at once a tile: back is the frame from before full screen", async () => {
    const { arranger, frames } = await lagging();
    await arranger.toggleFullscreen(7);
    await arranger.toggleFullscreen(7);
    await arranger.arrow(7, "left");
    await arranger.arrange(7, "restore");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...OWN }]);
  });

  test("a resize by hand: what the compositor reports is the size again", async () => {
    const { arranger, emit, frames, window } = await lagging();
    await arranger.arrow(7, "left");
    await emit({ event: "window-grab", window: 7, kind: "resize", frame: rect(6, 34, 800, 600), pointer: { x: 806, y: 300 } });
    window.frame = rect(6, 34, 700, 500);
    delete window.configuring;
    await arranger.arrange(7, "center");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(473, 197, 700, 500) }]);
  });
});

describe("bursts of keys", () => {
  type Step = { kind: "arrow"; arrow: "left" | "right" | "up" | "down" } | { kind: "arrange"; to: "fill" | "center" | "restore" } | { kind: "fullscreen" };
  const run = (arranger: Arranger, step: Step): Promise<void> =>
    step.kind === "arrow" ? arranger.arrow(7, step.arrow) : step.kind === "arrange" ? arranger.arrange(7, step.to) : arranger.toggleFullscreen(7);

  test("⌃❖↑ ⌃❖R ⌃❖↓ ⌃❖↩ ⌃❖C at once, the app drawing none of it yet: its own size, centered", async () => {
    const { arranger, frames } = await started(files(), undefined, true);
    const steps: Step[] = [
      { kind: "arrow", arrow: "up" },
      { kind: "arrange", to: "restore" },
      { kind: "arrow", arrow: "down" },
      { kind: "arrange", to: "fill" },
      { kind: "arrange", to: "center" },
    ];
    await Promise.all(steps.map((step) => run(arranger, step)));
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...rect(423, 147, 800, 600) }]);
    expect(arranger.arrangement(7)).toBeNull();
  });

  test("keys pressed together act in order: ← then ↑ is the top left", async () => {
    const { arranger, frames } = await started();
    await Promise.all([arranger.arrow(7, "left"), arranger.arrow(7, "up")]);
    expect(arranger.arrangement(7)).toBe("top-left");
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...tileFrame("top-left", USABLE) }]);
  });

  test("any burst ends where the same keys pressed slowly end, however late the app draws", async () => {
    const choices: Step[] = [
      { kind: "arrow", arrow: "left" },
      { kind: "arrow", arrow: "right" },
      { kind: "arrow", arrow: "up" },
      { kind: "arrow", arrow: "down" },
      { kind: "arrange", to: "fill" },
      { kind: "arrange", to: "center" },
      { kind: "arrange", to: "restore" },
      { kind: "fullscreen" },
    ];
    // A fixed seed: the same bursts every run.
    let seed = 20261105;
    const random = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % below;
    };
    const name = (step: Step) => (step.kind === "arrow" ? step.arrow : step.kind === "arrange" ? step.to : "fullscreen");
    for (let burst = 0; burst < 200; burst++) {
      const steps = Array.from({ length: 3 + random(4) }, () => choices[random(choices.length)] as Step);
      const slow = await started();
      for (const step of steps) await run(slow.arranger, step);
      const fast = await started(files(), undefined, true);
      const catchUpAt = random(steps.length + 1);
      await Promise.all(
        steps.map(async (step, index) => {
          if (index === catchUpAt) fast.catchUp();
          await run(fast.arranger, step);
        }),
      );
      fast.catchUp();
      const label = steps.map(name).join(" ");
      expect({ burst: label, frame: fast.window.frame, fullscreen: fast.window.fullscreen ?? false, arrangement: fast.arranger.arrangement(7) }).toEqual({
        burst: label,
        frame: slow.window.frame,
        fullscreen: slow.window.fullscreen ?? false,
        arrangement: slow.arranger.arrangement(7),
      });
    }
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
