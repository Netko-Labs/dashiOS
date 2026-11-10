import { expect, test } from "bun:test";
import { type GraphicsNotice, NOTICE_QUIET_MS, NOTICE_SETTLE_MS } from "../src/graphics/notice.ts";
import { GraphicsTeller } from "../src/graphics/teller.ts";
import { fakeTime } from "./support/graphics-notice.ts";

test("the teller: a cable wiggled three times in ten seconds gives one notice at most", () => {
  const time = fakeTime();
  const said: GraphicsNotice[] = [];
  const teller = new GraphicsTeller(true, { say: (notice) => void said.push(notice), withdraw: () => {}, now: time.now, later: time.later });
  teller.started("hybrid");
  // Out, in, out, in, out: it ends unplugged, and is said once, when it has held.
  for (const [at, plugged] of [
    [0, false],
    [2000, true],
    [4000, false],
    [7000, true],
    [10_000, false],
  ] as const) {
    time.advance(at - time.now());
    teller.changed(plugged ? "hybrid" : "integrated", plugged ? "plugged" : "unplugged");
  }
  time.advance(NOTICE_SETTLE_MS - 1);
  expect(said).toEqual([]);
  time.advance(1);
  expect(said.map((notice) => notice.summary)).toEqual(["Using the built-in graphics"]);
  // Out and back in within the settle time: nothing at all.
  time.advance(60_000);
  teller.changed("hybrid", "plugged");
  time.advance(1000);
  teller.changed("integrated", "unplugged");
  time.advance(60_000);
  expect(said.length).toBe(1);
  teller.close();
});

test("the teller: a later change waits out the quiet time, then says where it ended", () => {
  const time = fakeTime();
  const said: string[] = [];
  const teller = new GraphicsTeller(true, { say: (notice) => void said.push(notice.summary), withdraw: () => {}, now: time.now, later: time.later });
  teller.started("hybrid");
  teller.changed("integrated", "unplugged");
  time.advance(NOTICE_SETTLE_MS);
  teller.changed("hybrid", "plugged");
  time.advance(NOTICE_SETTLE_MS);
  expect(said).toEqual(["Using the built-in graphics"]);
  time.advance(NOTICE_QUIET_MS);
  expect(said).toEqual(["Using the built-in graphics", "The graphics card is on"]);
  teller.close();
});
