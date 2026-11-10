import { expect, test } from "bun:test";
import { decideNotice, type GraphicsChange, NOTICE_QUIET_MS, NOTICE_SETTLE_MS } from "../src/graphics/lib/notice.ts";

/** Unplugged, no notice before it, the new mode held long enough. */
const unplugged: GraphicsChange = {
  card: true,
  before: "hybrid",
  after: "integrated",
  why: "unplugged",
  held: NOTICE_SETTLE_MS,
  sinceNotice: null,
  waiting: false,
};

test("unplugged: the built-in graphics, why, and Use Hybrid; with the refresh rate in the same notice", () => {
  expect(decideNotice(unplugged)).toEqual({
    say: "notice",
    notice: {
      summary: "Using the built-in graphics",
      body: "Unplugged, so the graphics card sleeps to save battery.",
      actions: [{ key: "use-hybrid", label: "Use Hybrid" }],
    },
  });
  const both = decideNotice({ ...unplugged, rate: "60 Hz" });
  expect(both.say === "notice" && both.notice.body).toBe("Unplugged, so the graphics card sleeps and the screen runs at 60 Hz to save battery.");
});

test("plugged in: the card is on, with Graphics Settings… (its name from the pane list)", () => {
  const plugged: GraphicsChange = { ...unplugged, before: "integrated", after: "hybrid", why: "plugged", sinceNotice: 120_000 };
  expect(decideNotice(plugged)).toEqual({
    say: "notice",
    notice: {
      summary: "The graphics card is on",
      body: "Plugged in, so apps can use the graphics card again.",
      actions: [{ key: "settings", label: "Graphics Settings…" }],
    },
  });
  const both = decideNotice({ ...plugged, rate: "120 Hz" });
  expect(both.say === "notice" && both.notice.body).toBe("Plugged in, so apps can use the graphics card again, and the screen is back to 120 Hz.");
});

test("a screen on the card's port, coming and going, says so", () => {
  const on = decideNotice({ ...unplugged, before: "integrated", after: "hybrid", why: "screen" });
  expect(on.say === "notice" && on.notice.body).toBe("A screen is connected to the graphics card, so the card is on to show it.");
  const off = decideNotice({ ...unplugged, why: "screen-gone" });
  expect(off.say === "notice" && off.notice.body).toBe("The screen on the graphics card was unplugged, so the card sleeps to save battery.");
});

test("a change the person made says nothing, and ends a wait it interrupted", () => {
  expect(decideNotice({ ...unplugged, why: "chosen" })).toEqual({ say: "nothing", withdraw: false });
  expect(decideNotice({ ...unplugged, before: "integrated", after: "hybrid", why: "chosen", waiting: true })).toEqual({ say: "nothing", withdraw: true });
});

test("a switch that waited for apps is said at once, naming them, in place of the waiting notice", () => {
  // Waiting was posted a moment ago and the switch has only just happened: neither wait applies.
  const waited = decideNotice({ ...unplugged, why: "waited", held: 0, sinceNotice: 2000, waiting: true, waitedFor: ["Steam", "Helium"] });
  expect(waited).toEqual({
    say: "notice",
    notice: {
      summary: "Using the built-in graphics",
      body: "Steam and Helium quit, so the graphics card sleeps to save battery.",
      actions: [{ key: "use-hybrid", label: "Use Hybrid" }],
    },
  });
  // Plugged back in while waiting: no switch, and the waiting notice comes down.
  expect(decideNotice({ ...unplugged, after: "hybrid", why: "plugged", waiting: true })).toEqual({ say: "nothing", withdraw: true });
});

test("a failed switch says nothing new, and leaves the waiting notice as it is", () => {
  expect(decideNotice({ ...unplugged, why: "failed", waiting: true })).toEqual({ say: "nothing", withdraw: false });
  expect(decideNotice({ ...unplugged, after: null })).toEqual({ say: "nothing", withdraw: false });
});

test("flapping: a new mode waits until it holds, and notices come at most once in the quiet time", () => {
  expect(decideNotice({ ...unplugged, held: 0 })).toEqual({ say: "later", ms: NOTICE_SETTLE_MS });
  expect(decideNotice({ ...unplugged, held: 4000 })).toEqual({ say: "later", ms: NOTICE_SETTLE_MS - 4000 });
  expect(decideNotice({ ...unplugged, sinceNotice: 10_000 })).toEqual({ say: "later", ms: NOTICE_QUIET_MS - 10_000 });
  // Back to the mode last said: nothing to say.
  expect(decideNotice({ ...unplugged, after: "hybrid", why: "plugged" })).toEqual({ say: "nothing", withdraw: false });
});

test("one GPU, or before Dashi's first decision (login): nothing", () => {
  expect(decideNotice({ ...unplugged, card: false })).toEqual({ say: "nothing", withdraw: false });
  expect(decideNotice({ ...unplugged, before: null })).toEqual({ say: "nothing", withdraw: false });
});
