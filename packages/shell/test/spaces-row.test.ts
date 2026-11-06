import { describe, expect, test } from "bun:test";
import type { Output } from "../src/layout.ts";
import { edgeHoldTarget, screenBeyond } from "../src/spaces/edge.ts";
import { ROW } from "../src/spaces/model.ts";
import { lifted, SHELF, SHELF_HEIGHT, shelfLayout, shelfSpaceAt, shelfTarget } from "../src/spaces/shelf.ts";
import { CLOSE_AFTER_MS, RowViewStore, type Timers } from "../src/spaces/view.ts";

describe("the opened row", () => {
  test("pictures have the screen's shape, side by side, names under them, the + at the end", () => {
    const layout = shelfLayout(1920, 3, 16 / 9);
    expect(layout.pictures).toHaveLength(3);
    const [first, second] = layout.pictures;
    expect(first?.height).toBe(SHELF.picture);
    expect(first?.width).toBe(Math.round(SHELF.picture * (16 / 9)));
    expect((second?.x ?? 0) - (first?.x ?? 0)).toBe((first?.width ?? 0) + SHELF.gap);
    expect(layout.labels[0]?.y).toBe((first?.y ?? 0) + (first?.height ?? 0) + SHELF.below);
    expect(layout.add?.x).toBe(1920 - ROW.edge - ROW.add);
    // Centered.
    const last = layout.pictures[2];
    expect(Math.abs((first?.x ?? 0) - (1920 - (last?.x ?? 0) - (last?.width ?? 0)))).toBeLessThanOrEqual(1);
    expect(SHELF_HEIGHT).toBeGreaterThan(ROW.height);
  });

  test("many Desktops make the pictures smaller, never past the + or the row", () => {
    const layout = shelfLayout(1280, 12, 16 / 10);
    const last = layout.pictures.at(-1);
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThan(layout.add?.x ?? 0);
    expect(layout.pictures[0]?.x).toBeGreaterThan(0);
    expect(layout.pictures[0]?.height).toBeLessThan(SHELF.picture);
    // Their names stay on the same line as a full row's would.
    expect(layout.labels[0]?.y).toBe(SHELF.top + SHELF.picture + SHELF.below);
    expect(shelfLayout(1280, 16, 16 / 9).add).toBeNull();
  });

  test("a drop lands on a picture or its name, or the +; lifted pictures grow", () => {
    const layout = shelfLayout(1920, 2, 16 / 9);
    const [picture] = layout.pictures;
    const label = layout.labels[1];
    if (!picture || !label || !layout.add) throw new Error("no layout");
    expect(shelfTarget(layout, picture.x + 5, picture.y + 5)).toEqual({ kind: "space", index: 0 });
    expect(shelfTarget(layout, label.x + 5, label.y + 5)).toEqual({ kind: "space", index: 1 });
    expect(shelfTarget(layout, layout.add.x + 2, layout.add.y + 2)).toEqual({ kind: "add" });
    expect(shelfTarget(layout, 2, 2)).toBeNull();
    expect(shelfSpaceAt(layout, picture.x - 4, picture.y)).toBeNull();
    const up = lifted(picture);
    expect(up.width).toBeGreaterThan(picture.width);
    expect(up.y).toBeLessThan(picture.y);
  });
});

const screen = (name: string, x: number): Output => ({
  name,
  frame: { x, y: 0, width: 1920, height: 1080 },
  usable: { x, y: 30, width: 1920, height: 1050 },
  scale: 1,
});

describe("pushing a window against a side", () => {
  const one = [screen("eDP-1", 0)];
  const two = [screen("eDP-1", 0), screen("HDMI-A-1", 1920)];
  const spaces = { count: 3, current: 1 };

  test("goes to the next Desktop that way, up to the last", () => {
    expect(edgeHoldTarget({ edge: "right", output: "eDP-1", preview: false }, one, spaces)).toBe(2);
    expect(edgeHoldTarget({ edge: "left", output: "eDP-1", preview: false }, one, spaces)).toBe(0);
    expect(edgeHoldTarget({ edge: "right", output: "eDP-1", preview: false }, one, { count: 3, current: 2 })).toBeNull();
  });

  test("not toward another screen, not at the top or bottom, not while a tile preview shows", () => {
    expect(screenBeyond(two[0] as Output, "right", two)).toBe(true);
    expect(screenBeyond(two[0] as Output, "left", two)).toBe(false);
    expect(edgeHoldTarget({ edge: "right", output: "eDP-1", preview: false }, two, spaces)).toBeNull();
    expect(edgeHoldTarget({ edge: "left", output: "eDP-1", preview: false }, two, spaces)).toBe(0);
    expect(edgeHoldTarget({ edge: "right", output: "HDMI-A-1", preview: false }, two, spaces)).toBe(2);
    expect(edgeHoldTarget({ edge: "top", output: "eDP-1", preview: false }, one, spaces)).toBeNull();
    expect(edgeHoldTarget({ edge: "right", output: "eDP-1", preview: true }, one, spaces)).toBeNull();
    expect(edgeHoldTarget({ edge: "right", output: "DP-9", preview: false }, one, spaces)).toBeNull();
  });
});

/** Timers run by hand. */
function manualTimers(): Timers & { run(): void; pending(): number } {
  let queued: Array<{ run: () => void; handle: number }> = [];
  let next = 0;
  return {
    set(run) {
      next += 1;
      queued.push({ run, handle: next });
      return next;
    },
    clear(handle) {
      queued = queued.filter((each) => each.handle !== handle);
    },
    run() {
      const due = queued;
      queued = [];
      for (const each of due) each.run();
    },
    pending: () => queued.length,
  };
}

describe("the row opening", () => {
  test("the pointer opens it; it closes a moment after the pointer leaves, unless it comes back", () => {
    const timers = manualTimers();
    const view = new RowViewStore(timers);
    view.hover(true);
    expect(view.getSnapshot().open).toBe(true);
    view.hover(false);
    expect(view.getSnapshot().open).toBe(true);
    view.hover(true);
    expect(timers.pending()).toBe(0);
    view.hover(false);
    timers.run();
    expect(view.getSnapshot().open).toBe(false);
    expect(CLOSE_AFTER_MS).toBeGreaterThan(0);
  });

  test("moving onto a × (which takes the pointer from the row) keeps the row open", () => {
    const timers = manualTimers();
    const view = new RowViewStore(timers);
    view.hover(true);
    // The × occludes the row: the row hears the pointer leave, in either order with the × hearing it come.
    view.hover(false);
    view.hover(true, "close-1");
    timers.run();
    expect(view.getSnapshot().open).toBe(true);
    view.hover(true, "close-2");
    view.hover(false, "close-1");
    timers.run();
    expect(view.getSnapshot().open).toBe(true);
    view.hover(false, "close-2");
    timers.run();
    expect(view.getSnapshot().open).toBe(false);
  });

  test("a dragged window lifts the picture it is over, only while dragging and open", () => {
    const view = new RowViewStore(manualTimers());
    view.overSpace(1, true);
    expect(view.getSnapshot().lifted).toBeNull();
    view.drag(7);
    view.hover(true);
    expect(view.getSnapshot()).toEqual({ open: true, lifted: 1 });
    view.overSpace(1, false);
    view.overSpace(2, true);
    expect(view.getSnapshot().lifted).toBe(2);
    view.drag(null);
    expect(view.getSnapshot().lifted).toBeNull();
    view.drag(7);
    view.reset();
    expect(view.getSnapshot()).toEqual({ open: false, lifted: null });
    expect(view.draggedWindow).toBeNull();
  });
});
