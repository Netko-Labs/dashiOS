import { afterEach, expect, test } from "bun:test";
import { DOCK_MOTION, iconRise, panelOpacity, Slide } from "../src/dock/slide.tsx";
import { springOut } from "../src/shared/controls/motion.ts";

const slides: Slide[] = [];
const make = (reduce = false): Slide => {
  const slide = new Slide(0, () => reduce);
  slides.push(slide);
  return slide;
};
afterEach(() => {
  for (const slide of slides.splice(0)) slide.close();
});

/** Steps `slide` frame by frame for `ms`, collecting what it reads. */
function run(slide: Slide, ms: number): { position: number; rise: number }[] {
  const seen = [];
  for (let at = 0; at < ms; at += 16) {
    slide.step(16);
    seen.push(slide.getSnapshot());
  }
  return seen;
}

test("an entrance waits for the host to paint, then rises into place and settles", () => {
  const slide = make();
  slide.armEntrance();
  expect(slide.getSnapshot()).toEqual({ position: 1, rise: 0 });
  slide.step(16);
  expect(slide.getSnapshot().position).toBe(1);
  slide.ready();
  const seen = run(slide, DOCK_MOTION.entranceMs + 32);
  const positions = seen.map((state) => state.position);
  // Always rising, never past its place.
  for (let i = 1; i < positions.length; i++) expect(positions[i] as number).toBeLessThanOrEqual(positions[i - 1] as number);
  expect(Math.min(...positions)).toBeGreaterThanOrEqual(0);
  expect(slide.getSnapshot()).toEqual({ position: 0, rise: 1 });
  expect(slide.settled).toBe(true);
});

test("the panel is mostly up early: it decelerates into place", () => {
  const slide = make();
  slide.armEntrance();
  slide.ready();
  run(slide, DOCK_MOTION.showMs / 3);
  expect(slide.getSnapshot().position).toBeLessThan(0.25);
});

test("icons rise one after another, overshoot a little, and settle", () => {
  const early = DOCK_MOTION.showMs / 3 / DOCK_MOTION.entranceMs + 0.05;
  expect(iconRise(early, 0).offset).toBeLessThan(iconRise(early, 4).offset);
  expect(iconRise(0, 0)).toEqual({ offset: DOCK_MOTION.iconDrop, opacity: 0 });
  expect(iconRise(1, 7)).toEqual({ offset: 0, opacity: 1 });
  const curve = Array.from({ length: 101 }, (_, i) => springOut(i / 100));
  expect(Math.max(...curve)).toBeGreaterThan(1);
  expect(Math.max(...curve)).toBeLessThan(1.2);
  expect(springOut(1)).toBe(1);
});

test("the panel fades in with its rise and is opaque in place", () => {
  expect(panelOpacity({ position: 1, rise: 0 })).toBe(0);
  expect(panelOpacity({ position: 0, rise: 1 })).toBe(1);
});

test("an exit drops the panel away, icons untouched; coming back mid-way turns around without replaying them", () => {
  const slide = make();
  slide.hide();
  run(slide, DOCK_MOTION.hideMs / 2);
  const midway = slide.getSnapshot();
  expect(midway.position).toBeGreaterThan(0);
  expect(midway.rise).toBe(1);
  slide.show();
  run(slide, DOCK_MOTION.showMs + 32);
  expect(slide.getSnapshot()).toEqual({ position: 0, rise: 1 });
});

test("with Reduce Motion the Dock is simply there, or gone", () => {
  const slide = make(true);
  slide.armEntrance();
  slide.ready();
  expect(slide.getSnapshot()).toEqual({ position: 0, rise: 1 });
  slide.hide();
  expect(slide.getSnapshot()).toEqual({ position: 1, rise: 1 });
  expect(slide.settled).toBe(true);
});
