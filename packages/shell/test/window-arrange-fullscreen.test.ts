/**
 * Full screen and back, and an app that draws its size late: the size asked for counts until it is drawn.
 */

import { describe, expect, test } from "bun:test";
import { Arranger } from "../src/arrange/arrange.ts";
import { tileFrame } from "../src/layout.ts";
import { settle } from "./support/time.ts";
import { fake, files, OWN, rect, SCREEN, started, USABLE } from "./support/window-arrange.ts";

describe("full screen and back", () => {
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
    expect(frames().at(-1)).toEqual(["frame", { window: 7, ...tileFrame("left", USABLE), tiled: true }]);
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
