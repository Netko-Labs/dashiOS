import { expect, test } from "bun:test";
import type { Bounds } from "@mirinjs/metal";
import { Reveal, revealStep } from "../src/shared/file-browser/lib/marquee/reveal.ts";
import type { ListingModel } from "../src/shared/file-browser/lib/marquee/types.ts";
import { rowRects } from "../src/shared/file-browser/lib/views/list.tsx";
import type { WindowSurface } from "../src/shared/metal/index.ts";

test("an item out of view is scrolled just far enough to show whole; one in view moves nothing", () => {
  const row = (at: number) => ({ x: 5, y: at * 26, width: 390, height: 26 });
  // 20 rows and 8 under them, 130 showing, scrolled to 260 (rows 10 to 14 show).
  expect(revealStep(row(12), 260, 130, 528)).toBe(0);
  // Row 9, above: its top comes to the view's top.
  expect(revealStep(row(9), 260, 130, 528)).toBe(-26);
  // Row 15, below: its bottom comes to the view's bottom.
  expect(revealStep(row(15), 260, 130, 528)).toBe(26);
  // A row cut by the edge counts as out of view.
  expect(revealStep(row(10), 270, 130, 528)).toBe(-10);
  // The first row takes the listing to its start, the last to its end (the room under it too).
  expect(revealStep(row(0), 260, 130, 528)).toBe(-260);
  expect(revealStep(row(19), 260, 130, 528)).toBe(528 - 130 - 260);
});

/** A list of 20 rows, five showing, in a window that paints a scroll only when `paint` is called. */
function setup() {
  const paths = Array.from({ length: 20 }, (_, at) => `/f${at}`);
  const frame: Bounds = { x: 100, y: 50, width: 400, height: 130 };
  const world = { top: 0, painted: 0, scrolls: [] as number[], asked: 0 };
  const model: ListingModel = { scrollID: "list:rows", contentHeight: 20 * 26 + 8, paths, rects: rowRects(20, 400), nodeOf: (path) => `list:row:${path}` };
  const surface: WindowSurface = {
    bounds: async (ids) => {
      world.asked++;
      return ids.map((id) => {
        if (id === "list:rows") return frame;
        const at = paths.findIndex((path) => `list:row:${path}` === id);
        const y = frame.y + at * 26 - world.painted;
        return at < 0 || y + 26 < frame.y || y > frame.y + frame.height ? null : { x: frame.x + 5, y, width: 390, height: 26 };
      });
    },
    scrollBy: (_id, dy) => {
      world.scrolls.push(dy);
      world.top = Math.max(0, Math.min(20 * 26 + 8 - frame.height, world.top + dy));
    },
  };
  const listing = () => ({ surface, model });
  const turns = async (count = 20) => {
    for (let at = 0; at < count; at++) await Promise.resolve();
  };
  return { world, listing, turns, paint: () => void (world.painted = world.top) };
}

test("the keyboard's item is scrolled into view through the window, down and back up", async () => {
  const { world, listing, turns, paint } = setup();
  const reveal = new Reveal();
  reveal.show("/f3", listing);
  await turns();
  expect(world.scrolls).toEqual([]);
  reveal.show("/f5", listing);
  await turns();
  expect(world.scrolls).toEqual([26]);
  paint();
  await turns();
  reveal.show("/f19", listing);
  await turns();
  paint();
  await turns();
  expect(world.top).toBe(20 * 26 + 8 - 130);
  reveal.show("/f0", listing);
  await turns();
  paint();
  await turns();
  expect(world.top).toBe(0);
});

test("keys that repeat before a scroll is painted are not counted twice: it ends on the last one's item", async () => {
  const { world, listing, turns, paint } = setup();
  const reveal = new Reveal();
  reveal.show("/f5", listing);
  await turns(4);
  // Two more keys while the first scroll is not painted yet.
  reveal.show("/f6", listing);
  reveal.show("/f7", listing);
  await turns(60);
  // The first scroll never showed, and is still counted: 26 for row 5, then 52 more for row 7, not 78.
  expect(world.scrolls).toEqual([26, 52]);
  paint();
  // Row 7's bottom at the view's bottom: 8 × 26 − 130. Another key there moves nothing.
  expect(world.top).toBe(78);
  reveal.show("/f7", listing);
  await turns(60);
  expect(world.scrolls).toEqual([26, 52]);
});

test("a listing with no window, or an item that is not listed, scrolls nothing", async () => {
  const { world, listing, turns } = setup();
  const reveal = new Reveal();
  reveal.show("/gone", listing);
  reveal.show("/f9", () => ({ surface: null, model: listing().model }));
  await turns();
  expect(world.scrolls).toEqual([]);
});
