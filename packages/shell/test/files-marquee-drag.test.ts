import { expect, test } from "bun:test";
import type { Bounds, Modifiers, PointerInfo } from "@mirinjs/metal";
import { scrollStep, TICK_MS } from "../src/shared/file-browser/lib/marquee/geometry.ts";
import { CLICK_MS, Marquee, POLL_MS } from "../src/shared/file-browser/lib/marquee/session.ts";
import type { ListingModel, Timers } from "../src/shared/file-browser/lib/marquee/types.ts";
import { rowRects } from "../src/shared/file-browser/lib/views/list.tsx";
import type { WindowSurface } from "../src/shared/metal/index.ts";

const none: Modifiers = { shift: false, control: false, alt: false, super: false };
const shift: Modifiers = { ...none, shift: true };
const command: Modifiers = { ...none, super: true };

// --- A drag, from the press to the release --------------------------------------------------

/** A list of ten rows in a window: the listing's view at (100, 50), 400 × 130 (five rows show), scrolled by `top`. */
function setup(selection: string[] = []) {
  const paths = Array.from({ length: 10 }, (_, at) => `/f${at}`);
  const frame: Bounds = { x: 100, y: 50, width: 400, height: 130 };
  const world = { top: 0, selection, anchor: null as string | null, scrolls: [] as number[], asked: 0 };
  const store = {
    getSnapshot: () => ({ selection: world.selection, renaming: null }),
    sweep: (next: readonly string[], last: string | null) => {
      world.selection = [...next];
      if (last !== null) world.anchor = last;
    },
    commitRename: async () => true,
  };
  const model: ListingModel = {
    scrollID: "list:rows",
    contentHeight: 10 * 26 + 8,
    paths,
    rects: rowRects(10, 400),
    nodeOf: (path) => `list:row:${path}`,
  };
  const answers: (() => void)[] = [];
  const surface: WindowSurface = {
    bounds: (ids) =>
      new Promise((resolve) => {
        world.asked++;
        // Answered as the listing stands when the answer is let out, as the host would.
        answers.push(() =>
          resolve(
            ids.map((id) => {
              if (id === "list:rows") return frame;
              const at = paths.findIndex((path) => `list:row:${path}` === id);
              const y = frame.y + at * 26 - world.top;
              // Only what shows is painted.
              return at < 0 || y + 26 < frame.y || y > frame.y + frame.height ? null : { x: frame.x + 5, y, width: 390, height: 26 };
            }),
          ),
        );
      }),
    scrollBy: (_id, dy) => {
      world.scrolls.push(dy);
      world.top = Math.max(0, Math.min(10 * 26 + 8 - frame.height, world.top + dy));
    },
  };
  const timed: { ms: number; run: () => void }[] = [];
  const timers: Timers = {
    every: (ms, run) => {
      const entry = { ms, run };
      timed.push(entry);
      return () => void timed.splice(timed.indexOf(entry), 1);
    },
  };
  const marquee = new Marquee(store, timers);
  marquee.surface = surface;
  marquee.model = model;
  /** The pointer, from a host that says the keys held with it (`held`), or an older one that says none. */
  const send = (phase: PointerInfo["phase"], x: number, y: number, held?: Modifiers) =>
    marquee.pointerEvent({ phase, x, y, bounds: frame, ...(held ? { modifiers: held } : {}) });
  /** Let the window answer what it was asked. */
  const answer = async () => {
    for (const each of answers.splice(0)) each();
    await Promise.resolve();
    await Promise.resolve();
  };
  /** One tick of the scrolling timer, if it runs. */
  const tick = () => timed.find((entry) => entry.ms === TICK_MS)?.run();
  /** The drag's look at where the content stands, if it is due. */
  const poll = () => timed.find((entry) => entry.ms === POLL_MS)?.run();
  const scrolling = () => timed.some((entry) => entry.ms === TICK_MS);
  /** The wait for a release's click runs out, if one is on. */
  const wait = () => timed.find((entry) => entry.ms === CLICK_MS)?.run();
  return { marquee, world, send, answer, tick, poll, scrolling, wait, frame };
}

test("a press on empty space, dragged, selects what the rectangle touches, live, and keeps it on release", async () => {
  const { marquee, world, send, answer } = setup(["/f9"]);
  send("down", 400, 60);
  send("move", 402, 61);
  expect(marquee.getSnapshot().dragging).toBe(false);
  send("move", 420, 100);
  await answer();
  // From y 60 to 100: rows 0 (50 to 76) and 1 (76 to 102).
  expect(world.selection).toEqual(["/f0", "/f1"]);
  expect(marquee.getSnapshot()).toEqual({ rect: { x: 300, y: 10, width: 20, height: 40 }, dragging: true });
  send("move", 420, 110);
  expect(world.selection).toEqual(["/f0", "/f1", "/f2"]);
  send("move", 420, 70);
  expect(world.selection).toEqual(["/f0"]);
  send("up", 420, 110);
  expect(world.selection).toEqual(["/f0", "/f1", "/f2"]);
  expect(marquee.getSnapshot()).toEqual({ rect: null, dragging: false });
  // The keyboard goes on from the last row it took.
  expect(world.anchor).toBe("/f2");
});

test("a click without a drag is left to the click, and the click after a drag is the drag's", async () => {
  const { marquee, world, send, answer } = setup(["/f3"]);
  send("down", 400, 60);
  send("up", 401, 60);
  expect(marquee.press(none)).toBe(false);
  expect(world.asked).toBe(0);
  send("down", 400, 60);
  send("move", 400, 90);
  await answer();
  send("up", 400, 90);
  expect(marquee.press(none)).toBe(true);
  expect(world.selection).toEqual(["/f0", "/f1"]);
  // Only that one click: the next is a click again.
  expect(marquee.press(none)).toBe(false);
});

test("from a host that says no keys with the pointer, ⇧ adds and ❖ toggles at the click the release makes, before it or after", async () => {
  const added = setup(["/f1", "/f7"]);
  added.send("down", 400, 60);
  added.send("move", 400, 110);
  await added.answer();
  added.send("up", 400, 110);
  expect(added.marquee.press(shift)).toBe(true);
  expect(added.world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);

  const toggled = setup(["/f1", "/f7"]);
  toggled.send("down", 400, 60);
  toggled.send("move", 400, 110);
  await toggled.answer();
  // The click first, then the release.
  expect(toggled.marquee.press(command)).toBe(true);
  expect(toggled.world.selection).toEqual(["/f7", "/f0", "/f2"]);
  toggled.send("up", 400, 110);
  expect(toggled.world.selection).toEqual(["/f7", "/f0", "/f2"]);
});

test("⇧ and ❖ drags show the kept selection from the first move, and a release anywhere keeps the rule", async () => {
  const added = setup(["/f1", "/f7"]);
  added.send("down", 400, 60, shift);
  added.send("move", 400, 110, shift);
  await added.answer();
  // Live, with the button still down: rows 0 to 2 added to what was selected.
  expect(added.world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);
  // Let go outside the listing (the sidebar): no click comes, and nothing is lost.
  added.send("up", 20, 110, shift);
  expect(added.world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);
  expect(added.marquee.getSnapshot()).toEqual({ rect: null, dragging: false });

  const toggled = setup(["/f1", "/f7"]);
  toggled.send("down", 400, 60, command);
  toggled.send("move", 400, 110, command);
  await toggled.answer();
  expect(toggled.world.selection).toEqual(["/f7", "/f0", "/f2"]);
  toggled.send("up", 400, 110, command);
  // The click the release makes is the drag's, and its keys change nothing.
  expect(toggled.marquee.press(none)).toBe(true);
  expect(toggled.world.selection).toEqual(["/f7", "/f0", "/f2"]);
});

test("a key pressed or let go during the drag changes its rule there and then", async () => {
  const { world, send, answer } = setup(["/f1", "/f7"]);
  send("down", 400, 60, none);
  send("move", 400, 110, none);
  await answer();
  expect(world.selection).toEqual(["/f0", "/f1", "/f2"]);
  // ⇧ goes down with the pointer still: the host sends a move where it is.
  send("move", 400, 110, shift);
  expect(world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);
  // ⇧ up, ❖ down.
  send("move", 400, 110, command);
  expect(world.selection).toEqual(["/f7", "/f0", "/f2"]);
  // Let go of ❖ before the button: the release is a plain one.
  send("move", 400, 110, none);
  send("up", 400, 110, none);
  expect(world.selection).toEqual(["/f0", "/f1", "/f2"]);
});

test("a drag let go where no click is made does not take the next click, made without the pointer", async () => {
  const { marquee, send, answer, wait } = setup();
  send("down", 400, 60, none);
  send("move", 400, 110, none);
  await answer();
  // Let go on another row than the press was on: no click comes.
  send("up", 400, 110, none);
  wait();
  // A row pressed by a screen reader, later: a click of its own.
  expect(marquee.press(none)).toBe(false);
});

test("Esc ends the drag and puts back the selection and the keyboard's place from before", async () => {
  const { marquee, world, send, answer } = setup(["/f8", "/f9"]);
  world.anchor = "/f8";
  expect(marquee.cancel()).toBe(false);
  send("down", 400, 60);
  send("move", 400, 110);
  await answer();
  expect(world.selection).toEqual(["/f0", "/f1", "/f2"]);
  expect(marquee.cancel()).toBe(true);
  expect(world.selection).toEqual(["/f8", "/f9"]);
  expect(world.anchor).toBe("/f8");
  expect(marquee.getSnapshot()).toEqual({ rect: null, dragging: false });
  // What is left of the press does nothing, and its click is not a click.
  send("move", 400, 150);
  send("up", 400, 150);
  expect(world.selection).toEqual(["/f8", "/f9"]);
  expect(marquee.press(none)).toBe(true);
  expect(world.selection).toEqual(["/f8", "/f9"]);
});

test("past the bottom edge the listing scrolls and the rectangle, held to its items, grows", async () => {
  const { marquee, world, send, answer, tick, poll, scrolling } = setup();
  send("down", 400, 60);
  send("move", 400, 100);
  await answer();
  expect(scrolling()).toBe(false);
  // 60 past the bottom edge (180).
  send("move", 400, 240);
  expect(scrolling()).toBe(true);
  // Down to the view's bottom edge, where row 5 starts: touching it takes it.
  expect(world.selection).toEqual(["/f0", "/f1", "/f2", "/f3", "/f4", "/f5"]);
  tick();
  tick();
  const step = scrollStep(240, 50, 180);
  expect(world.scrolls).toEqual([step, step]);
  // The rectangle starts where the press was, now scrolled up by two steps, and ends at the bottom edge.
  expect(marquee.getSnapshot().rect).toEqual({ x: 300, y: 0, width: 0, height: 130 });
  for (let at = 0; at < 20; at++) tick();
  // At the end it stops asking for more, and every row down to the last is taken.
  expect(world.top).toBe(10 * 26 + 8 - 130);
  expect(world.selection.length).toBe(10);
  expect(scrolling()).toBe(false);
  // Once it stopped, the window is asked where the content stands: not at once (the last step may not be painted), a poll later.
  const asked = world.asked;
  poll();
  expect(world.asked).toBe(asked);
  poll();
  expect(world.asked).toBe(asked + 1);
  await answer();
  send("up", 400, 240);
  expect(world.selection.length).toBe(10);
  expect(world.anchor).toBe("/f9");
});

test("a wheel during the drag moves the items under the rectangle: the window is asked where they are", async () => {
  const { world, send, answer, poll } = setup();
  send("down", 400, 60);
  send("move", 400, 100);
  await answer();
  expect(world.selection).toEqual(["/f0", "/f1"]);
  // The host scrolled by itself: two rows up.
  world.top = 52;
  poll();
  await answer();
  // The press was on row 0's place, which is now 52 above the view: rows 0 to 3 lie between it and the pointer.
  expect(world.selection).toEqual(["/f0", "/f1", "/f2", "/f3"]);
});

test("a drag that starts outside what scrolls draws nothing, and its click stays a click", async () => {
  const { marquee, world, send, answer } = setup(["/f3"]);
  // Above the scroll view (a list's header).
  send("down", 400, 40);
  send("move", 400, 100);
  await answer();
  expect(marquee.getSnapshot().dragging).toBe(false);
  expect(world.selection).toEqual(["/f3"]);
  expect(marquee.press(none)).toBe(false);
});

test("without a window to ask, nothing is dragged out", () => {
  const { marquee, world, send } = setup(["/f3"]);
  marquee.surface = null;
  send("down", 400, 60);
  send("move", 400, 100);
  send("up", 400, 100);
  expect(world.selection).toEqual(["/f3"]);
  expect(marquee.press(none)).toBe(false);
});
