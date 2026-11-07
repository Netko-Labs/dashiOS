import { expect, test } from "bun:test";
import { wheelFlicks } from "../src/agents/desktop/input.ts";

const sum = (flicks: Array<{ dx: number; dy: number }>) =>
  flicks.reduce((total, flick) => ({ dx: total.dx + flick.dx, dy: total.dy + flick.dy }), { dx: 0, dy: 0 });

test("a long scroll is many wheel flicks of at most 8 notches, adding up to it", () => {
  // The scroll that froze the display (review 20) was one 2400 pixel event: 160 notches at once.
  const flicks = wheelFlicks(0, 2400);
  expect(flicks).toHaveLength(20);
  expect(flicks.every((flick) => flick.dx === 0 && flick.dy === 120)).toBe(true);
  expect(wheelFlicks(0, 400)).toEqual(Array.from({ length: 4 }, () => ({ dx: 0, dy: 100 })));
  const total = sum(wheelFlicks(-250, 1000));
  expect(total.dx).toBeCloseTo(-250);
  expect(total.dy).toBeCloseTo(1000);
  expect(wheelFlicks(30, -1000).every((flick) => Math.abs(flick.dy) <= 120)).toBe(true);
});

test("a short scroll stays one event", () => {
  expect(wheelFlicks(0, 120)).toEqual([{ dx: 0, dy: 120 }]);
  expect(wheelFlicks(-15, 0)).toEqual([{ dx: -15, dy: 0 }]);
  expect(wheelFlicks(0, 0)).toEqual([]);
});
