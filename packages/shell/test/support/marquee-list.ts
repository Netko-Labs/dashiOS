// A list of rows with a marquee on it, on a stand-in for the listing's scroll view (test/files-marquee-drag.test.ts).

import type { Bounds, Modifiers, PointerInfo, ViewHandle } from "@mirinjs/metal";
import { TICK_MS } from "../../src/shared/file-browser/lib/marquee/geometry.ts";
import { ScrollPlace } from "../../src/shared/file-browser/lib/marquee/place.ts";
import { CLICK_MS, Marquee } from "../../src/shared/file-browser/lib/marquee/session.ts";
import type { ListingModel, Timers } from "../../src/shared/file-browser/lib/marquee/types.ts";
import { rowRects } from "../../src/shared/file-browser/lib/views/list.tsx";

/**
 * A list of ten rows in a window: the rows' scroll view at (100, 50), 400 × 130 (five rows show). The view
 * is scrolled when asked (`scrollTo`), and says so only when a frame is drawn (`frame()`), as the host does.
 */
export function marqueeList(selection: string[] = [], scrolls = true) {
  const paths = Array.from({ length: 10 }, (_, at) => `/f${at}`);
  const frame: Bounds = { x: 100, y: 50, width: 400, height: 130 };
  const most = 10 * 26 + 8 - frame.height;
  const world = { top: 0, told: 0, selection, anchor: null as string | null, scrolls: [] as number[] };
  const store = {
    getSnapshot: () => ({ selection: world.selection, renaming: null }),
    sweep: (next: readonly string[], last: string | null) => {
      world.selection = [...next];
      if (last !== null) world.anchor = last;
    },
    commitRename: async () => true,
  };
  const model: ListingModel = { contentHeight: 10 * 26 + 8, paths, rects: rowRects(10, 400) };
  const timed: { ms: number; run: () => void }[] = [];
  const timers: Timers = {
    every: (ms, run) => {
      const entry = { ms, run };
      timed.push(entry);
      return () => void timed.splice(timed.indexOf(entry), 1);
    },
  };
  const clock = { now: 0 };
  const place = new ScrollPlace(() => clock.now);
  const handle: ViewHandle = {
    scrollTo: ({ y }) => {
      if (y === undefined) return;
      world.scrolls.push(y);
      world.top = Math.max(0, Math.min(most, y));
    },
    scrollToEnd: () => {},
    scrollIntoView: () => {},
  };
  place.attach(handle);
  place.layout(frame);
  const marquee = new Marquee(store, timers, place);
  marquee.surface = { scrolls: () => scrolls };
  marquee.model = model;
  /** The pointer, from a host that says the keys held with it (`held`), or an older one that says none. */
  const send = (phase: PointerInfo["phase"], x: number, y: number, held?: Modifiers) =>
    marquee.pointerEvent({ phase, x, y, bounds: frame, ...(held ? { modifiers: held } : {}) });
  /** A frame is drawn: the view says where it stands, if it moved. */
  const drawn = () => {
    if (world.told === world.top) return;
    world.told = world.top;
    place.scroll({
      contentOffset: { x: 0, y: world.top },
      contentSize: { width: frame.width, height: 10 * 26 + 8 },
      layoutMeasurement: { width: frame.width, height: frame.height },
    });
  };
  /** One tick of the scrolling timer, if it runs. */
  const run = () => timed.find((entry) => entry.ms === TICK_MS)?.run();
  /** A tick and the frame after it. */
  const tick = () => {
    run();
    drawn();
  };
  const scrolling = () => timed.some((entry) => entry.ms === TICK_MS);
  /** The wait for a release's click runs out, if one is on. */
  const wait = () => timed.find((entry) => entry.ms === CLICK_MS)?.run();
  return { marquee, world, send, tick, run, drawn, scrolling, wait, frame, place, clock };
}
