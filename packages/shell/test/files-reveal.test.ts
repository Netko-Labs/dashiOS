import { expect, test } from "bun:test";
import type { Bounds, ViewHandle } from "@mirinjs/metal";
import { ScrollPlace } from "../src/shared/file-browser/lib/marquee/place.ts";
import { reveal, revealStep } from "../src/shared/file-browser/lib/marquee/reveal.ts";
import type { ListingModel } from "../src/shared/file-browser/lib/marquee/types.ts";
import { rowRects } from "../src/shared/file-browser/lib/views/list.tsx";

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

/** A list of 20 rows, five showing, whose scroll view says where it stands only when `drawn` is called (a frame). */
function setup() {
  const paths = Array.from({ length: 20 }, (_, at) => `/f${at}`);
  const frame: Bounds = { x: 100, y: 50, width: 400, height: 130 };
  const height = 20 * 26 + 8;
  const world = { top: 0, scrolls: [] as number[] };
  const model: ListingModel = { contentHeight: height, paths, rects: rowRects(20, 400) };
  const place = new ScrollPlace(() => 0);
  const handle: ViewHandle = {
    scrollTo: ({ y }) => {
      if (y === undefined) return;
      world.scrolls.push(y);
      world.top = Math.max(0, Math.min(height - frame.height, y));
    },
    scrollToEnd: () => {},
    scrollIntoView: () => {},
  };
  place.attach(handle);
  place.layout(frame);
  const drawn = () =>
    place.scroll({
      contentOffset: { x: 0, y: world.top },
      contentSize: { width: 400, height },
      layoutMeasurement: { width: 400, height: frame.height },
    });
  return { world, model, place, drawn, handle };
}

test("the keyboard's item is scrolled into view, down and back up", () => {
  const { world, model, place, drawn } = setup();
  reveal("/f3", model, place);
  expect(world.scrolls).toEqual([]);
  reveal("/f5", model, place);
  expect(world.scrolls).toEqual([26]);
  drawn();
  reveal("/f19", model, place);
  drawn();
  expect(world.top).toBe(20 * 26 + 8 - 130);
  reveal("/f0", model, place);
  drawn();
  expect(world.top).toBe(0);
});

test("keys that repeat before a scroll is told back go on from where it was sent: it ends on the last one's item", () => {
  const { world, model, place, drawn } = setup();
  reveal("/f5", model, place);
  // Two more keys before a frame is drawn.
  reveal("/f6", model, place);
  reveal("/f7", model, place);
  // Row 7's bottom at the view's bottom: 8 × 26 − 130.
  expect(world.scrolls).toEqual([26, 52, 78]);
  drawn();
  // Another key there moves nothing.
  reveal("/f7", model, place);
  expect(world.scrolls).toEqual([26, 52, 78]);
});

test("another scroll view (icons to list, a folder that was empty) starts at its start", () => {
  const { world, model, place, drawn, handle } = setup();
  reveal("/f19", model, place);
  drawn();
  expect(place.top).toBe(398);
  place.attach(null);
  place.attach({ ...handle });
  place.layout({ x: 100, y: 50, width: 400, height: 130 });
  expect(place.top).toBe(0);
  reveal("/f5", model, place);
  expect(world.scrolls.at(-1)).toBe(26);
});

test("a listing not laid out yet, or an item that is not listed, scrolls nothing", () => {
  const { world, model, place } = setup();
  reveal("/gone", model, place);
  reveal("/f9", null, place);
  reveal("/f9", model, new ScrollPlace());
  expect(world.scrolls).toEqual([]);
});
