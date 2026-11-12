/**
 * Window arrangement's layout: the tile frames, Center, the frames carried between screens and kept under
 * the pointer, the drag zones, and the ⌃❖ arrows' steps and screens.
 */

import { describe, expect, test } from "bun:test";
import { arrowStep, screenToward } from "../src/arrange/tiling.ts";
import { carryFrame, centerFrame, dragZones, frameUnderPointer, TILES, tileFrame } from "../src/layout.ts";
import { rect, SCREEN, USABLE } from "./support/window-arrange.ts";

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
