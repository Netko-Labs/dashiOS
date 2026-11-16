/**
 * The key gestures (src/dictation/lib/gestures.ts, keys.ts): what a press
 * turned out to be, and which key dictates on which layout. Split from
 * dictation-keys.test.ts, which keeps what the Dashi key does.
 */
import { expect, test } from "bun:test";
import { dictationKey, pillHeldKeys, usesAltGr } from "../src/dictation/keys.ts";
import { KeyGestures } from "../src/dictation/lib/gestures.ts";
import { handTimers } from "./support/voice.ts";

function pressing(doubles = false) {
  const timers = handTimers();
  const clock = { now: 0 };
  const told: string[] = [];
  const keys = new KeyGestures("dictation", { timers, now: () => clock.now, tell: (gesture) => told.push(gesture.gesture), doubles });
  const pass = (ms: number): void => {
    clock.now += ms;
    timers.advance(ms);
  };
  return { keys, told, pass };
}

test("a short press is a tap, told as the key comes up; a long one is a hold, then up", () => {
  const { keys, told, pass } = pressing();
  keys.down();
  pass(120);
  expect(told).toEqual(["down"]);
  keys.up();
  expect(told).toEqual(["down", "tap"]);
  keys.down();
  pass(300);
  expect(told).toEqual(["down", "tap", "down", "hold"]);
  expect(keys.held).toBe(true);
  pass(2000);
  keys.up();
  expect(told.slice(4)).toEqual(["up"]);
});

test("another key under it makes it a chord, before or after it became a hold", () => {
  const { keys, told, pass } = pressing();
  keys.down();
  pass(50);
  keys.up(true);
  // Its release, when it comes, says nothing more.
  keys.up();
  expect(told).toEqual(["down", "chord"]);
  keys.down();
  pass(400);
  keys.up(true);
  expect(told.slice(2)).toEqual(["down", "hold", "chord"]);
});

test("a second press soon after a tap is a double tap, for the dictation key only", () => {
  const { keys, told, pass } = pressing(true);
  keys.down();
  pass(80);
  keys.up();
  pass(200);
  keys.down();
  pass(80);
  keys.up();
  expect(told).toEqual(["down", "tap", "double-tap"]);
  // Too late, it is a tap of its own.
  pass(351);
  keys.down();
  keys.up();
  pass(351);
  keys.down();
  keys.up();
  expect(told.slice(3)).toEqual(["down", "tap", "down", "tap"]);
  const single = pressing(false);
  single.keys.down();
  single.keys.up();
  single.keys.down();
  single.keys.up();
  expect(single.told).toEqual(["down", "tap", "down", "tap"]);
});

test("the dictation key is the right ⌥, or Caps Lock where the right ⌥ is AltGr", () => {
  expect(usesAltGr({ layout: "us" })).toBe(false);
  expect(usesAltGr({})).toBe(false);
  expect(usesAltGr({ layout: "us", variant: "dvorak" })).toBe(false);
  expect(usesAltGr({ layout: "us", variant: "intl" })).toBe(true);
  expect(usesAltGr({ layout: "es" })).toBe(true);
  expect(usesAltGr({ layout: "latam,us" })).toBe(true);
  expect(dictationKey(undefined, { layout: "us" })).toMatchObject({ id: "right-option", code: 100, modifier: true });
  expect(dictationKey("auto", { layout: "es" })).toMatchObject({ id: "caps-lock", code: 58, modifier: false });
  // The person's choice stands whatever the layout; a key that already talks to Dashi is passed by.
  expect(dictationKey("right-option", { layout: "es" }).id).toBe("right-option");
  expect(dictationKey(undefined, { layout: "us" }, [100]).id).toBe("caps-lock");
  expect(dictationKey(undefined, { layout: "es" }, [58]).id).toBe("right-control");
});

test("what the compositor is asked to hear: ❖Space with its tap, the right ⌥ alone, Caps Lock taken", () => {
  expect(pillHeldKeys({ dashi: true, dictation: dictationKey(undefined, { layout: "us" }) })).toEqual([
    { name: "dashi", code: 57, super: true, tapMs: 300 },
    { name: "dictation", code: 100, alone: true },
  ]);
  expect(pillHeldKeys({ dashi: true, dictation: dictationKey(undefined, { layout: "es" }) })[1]).toEqual({ name: "dictation", code: 58 });
  expect(pillHeldKeys({ dashi: false, dictation: null })).toEqual([]);
});
