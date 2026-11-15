import { expect, test } from "bun:test";
import type { Modifiers } from "@mirinjs/metal";
import { scrollStep } from "../src/shared/file-browser/lib/marquee/geometry.ts";
import { marqueeList as setup } from "./support/marquee-list.ts";

const none: Modifiers = { shift: false, control: false, alt: false, super: false };
const shift: Modifiers = { ...none, shift: true };
const command: Modifiers = { ...none, super: true };

// --- A drag, from the press to the release --------------------------------------------------

test("a press on empty space, dragged, selects what the rectangle touches, live, and keeps it on release", async () => {
  const { marquee, world, send } = setup(["/f9"]);
  send("down", 400, 60);
  send("move", 402, 61);
  expect(marquee.getSnapshot().dragging).toBe(false);
  send("move", 420, 100);
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
  const { marquee, world, send } = setup(["/f3"]);
  send("down", 400, 60);
  send("up", 401, 60);
  expect(marquee.press(none)).toBe(false);
  send("down", 400, 60);
  send("move", 400, 90);
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
  added.send("up", 400, 110);
  expect(added.marquee.press(shift)).toBe(true);
  expect(added.world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);

  const toggled = setup(["/f1", "/f7"]);
  toggled.send("down", 400, 60);
  toggled.send("move", 400, 110);
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
  // Live, with the button still down: rows 0 to 2 added to what was selected.
  expect(added.world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);
  // Let go outside the listing (the sidebar): no click comes, and nothing is lost.
  added.send("up", 20, 110, shift);
  expect(added.world.selection).toEqual(["/f1", "/f7", "/f0", "/f2"]);
  expect(added.marquee.getSnapshot()).toEqual({ rect: null, dragging: false });

  const toggled = setup(["/f1", "/f7"]);
  toggled.send("down", 400, 60, command);
  toggled.send("move", 400, 110, command);
  expect(toggled.world.selection).toEqual(["/f7", "/f0", "/f2"]);
  toggled.send("up", 400, 110, command);
  // The click the release makes is the drag's, and its keys change nothing.
  expect(toggled.marquee.press(none)).toBe(true);
  expect(toggled.world.selection).toEqual(["/f7", "/f0", "/f2"]);
});

test("a key pressed or let go during the drag changes its rule there and then", async () => {
  const { world, send } = setup(["/f1", "/f7"]);
  send("down", 400, 60, none);
  send("move", 400, 110, none);
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
  const { marquee, send, wait } = setup();
  send("down", 400, 60, none);
  send("move", 400, 110, none);
  // Let go on another row than the press was on: no click comes.
  send("up", 400, 110, none);
  wait();
  // A row pressed by a screen reader, later: a click of its own.
  expect(marquee.press(none)).toBe(false);
});

test("Esc ends the drag and puts back the selection and the keyboard's place from before", async () => {
  const { marquee, world, send } = setup(["/f8", "/f9"]);
  world.anchor = "/f8";
  expect(marquee.cancel()).toBe(false);
  send("down", 400, 60);
  send("move", 400, 110);
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
  const { marquee, world, send, tick, scrolling } = setup();
  send("down", 400, 60);
  send("move", 400, 100);
  expect(scrolling()).toBe(false);
  // 60 past the bottom edge (180).
  send("move", 400, 240);
  expect(scrolling()).toBe(true);
  // Down to the view's bottom edge, where row 5 starts: touching it takes it.
  expect(world.selection).toEqual(["/f0", "/f1", "/f2", "/f3", "/f4", "/f5"]);
  tick();
  tick();
  const step = scrollStep(240, 50, 180);
  // Asked for as offsets from the content's start.
  expect(world.scrolls).toEqual([step, 2 * step]);
  // The rectangle starts where the press was, now scrolled up by two steps, and ends at the bottom edge.
  expect(marquee.getSnapshot().rect).toEqual({ x: 300, y: 0, width: 0, height: 130 });
  for (let at = 0; at < 20; at++) tick();
  // At the end it stops asking for more, and every row down to the last is taken.
  expect(world.top).toBe(10 * 26 + 8 - 130);
  expect(world.selection.length).toBe(10);
  expect(scrolling()).toBe(false);
  send("up", 400, 240);
  expect(world.selection.length).toBe(10);
  expect(world.anchor).toBe("/f9");
});

test("ticks that come before a frame is drawn go on from where the last one sent the listing", () => {
  const { marquee, world, send, run, drawn } = setup();
  send("down", 400, 60);
  send("move", 400, 240);
  const step = scrollStep(240, 50, 180);
  // Two ticks, and the view has said nothing yet: the second is not sent to where the first was.
  run();
  run();
  expect(world.scrolls).toEqual([step, 2 * step]);
  // The rectangle is still drawn against what is painted: the anchor has not moved.
  expect(marquee.getSnapshot().rect).toEqual({ x: 300, y: 10, width: 0, height: 120 });
  drawn();
  expect(marquee.getSnapshot().rect).toEqual({ x: 300, y: 0, width: 0, height: 130 });
});

test("a scroll asked for that the view never tells back is forgotten, and the drag goes on from where the view says it is", () => {
  const { world, send, place, clock } = setup();
  send("down", 400, 60);
  send("move", 400, 100);
  // Sent to 40; the view does not say (it was held where it stood).
  place.scrollTo(40, 138);
  world.top = 0;
  expect(place.top).toBe(40);
  clock.now = 300;
  expect(place.top).toBe(0);
});

test("a wheel during the drag moves the items under the rectangle: the view says so and the rectangle follows", () => {
  const { marquee, world, send, drawn } = setup();
  send("down", 400, 60);
  send("move", 400, 100);
  expect(world.selection).toEqual(["/f0", "/f1"]);
  // The host scrolled by itself: two rows up.
  world.top = 52;
  drawn();
  // The press was on row 0's place, which is now 52 above the view: rows 0 to 3 lie between it and the pointer.
  expect(world.selection).toEqual(["/f0", "/f1", "/f2", "/f3"]);
  // Drawn from the view's top edge (the anchor is above it) to the pointer.
  expect(marquee.getSnapshot().rect).toEqual({ x: 300, y: 0, width: 0, height: 50 });
});

test("the view moved in its window (a sidebar shown) mid-drag: the rectangle is worked out again", () => {
  const { marquee, send, place, frame } = setup();
  send("down", 400, 60);
  send("move", 420, 100);
  place.layout({ ...frame, y: 40 });
  // The content is 10 higher, so the anchor is, and the rectangle is 10 taller.
  expect(marquee.getSnapshot().rect?.height).toBe(50);
});

test("a drag that starts outside what scrolls draws nothing, and its click stays a click", async () => {
  const { marquee, world, send } = setup(["/f3"]);
  // Above the scroll view (a list's header).
  send("down", 400, 40);
  send("move", 400, 100);
  expect(marquee.getSnapshot().dragging).toBe(false);
  expect(world.selection).toEqual(["/f3"]);
  expect(marquee.press(none)).toBe(false);
});

test("on a host that says no scroll position, and with no window at all, nothing is dragged out", () => {
  const old = setup(["/f3"], false);
  old.send("down", 400, 60);
  old.send("move", 400, 100);
  old.send("up", 400, 100);
  expect(old.world.selection).toEqual(["/f3"]);
  expect(old.marquee.press(none)).toBe(false);

  const { marquee, world, send } = setup(["/f3"]);
  marquee.surface = null;
  send("down", 400, 60);
  send("move", 400, 100);
  send("up", 400, 100);
  expect(world.selection).toEqual(["/f3"]);
  expect(marquee.press(none)).toBe(false);
});
