/**
 * The two keys (src/dictation/keys.ts, lib/gestures.ts, start.ts;
 * docs/night-0.9-contract.md, "core"): what a press turned out to be, which
 * key dictates on which layout, and what the Dashi key does.
 */

import { expect, test } from "bun:test";
import { dictationKey, pillHeldKeys, tapClosesLauncher, usesAltGr } from "../src/dictation/keys.ts";
import { KeyGestures } from "../src/dictation/lib/gestures.ts";
import { type DictationOptions, startDictation } from "../src/dictation/start.ts";
import { createPillHub, type DictationKeyId } from "../src/shared/pill/index.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

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

function started() {
  const voice = fakeVoice({ "listen.stop": { text: "hello", speech_ms: 500 } });
  const timers = handTimers();
  const hub = createPillHub();
  const clock = { now: 0 };
  const did: string[] = [];
  const held: string[][] = [];
  const settings = { voiceOn: true, on: true, key: undefined as DictationKeyId | undefined, handsFree: true, tidy: true, layout: { layout: "us" } };
  const listeners = new Set<() => void>();
  const options: DictationOptions = {
    hub,
    service: voice.service,
    settings: () => settings,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    talkCodes: () => [193],
    hold: (keys) => held.push(keys.map((key) => `${key.name}:${key.code}`)),
    voice: { hold: () => did.push("voice.hold"), release: () => did.push("voice.release"), stop: () => did.push("voice.stop") },
    launcher: () => did.push("launcher"),
    trouble: () => null,
    busy: () => false,
    muted: async () => false,
    front: async () => ({ window: 7, pid: 70 }),
    secret: async () => null,
    pressed: async () => null,
    typeText: async (_window, text) => void did.push(`type:${text}`),
    paste: async () => false,
    copy: async () => true,
    chime: () => {},
    taught: () => true,
    teach: () => {},
    timers,
    now: () => clock.now,
  };
  const parts = startDictation(options);
  const gestures: string[] = [];
  hub.keys.listen((gesture) => gestures.push(`${gesture.key}:${gesture.gesture}`));
  const pass = (ms: number): void => {
    clock.now += ms;
    timers.advance(ms);
  };
  const change = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return { parts, hub, did, held, gestures, settings, pass, change, voice };
}

test("a tap of the Dashi key opens the launcher as it comes up; kept down, it talks to Dashi", () => {
  const { parts, did, gestures, pass } = started();
  parts.key("dashi", true);
  expect(did).toEqual([]);
  pass(100);
  parts.key("dashi", false);
  expect(did).toEqual(["launcher"]);
  expect(gestures).toEqual(["dashi:down", "dashi:tap"]);
  parts.key("dashi", true);
  pass(300);
  expect(did).toEqual(["launcher", "voice.hold"]);
  pass(1500);
  parts.key("dashi", false);
  expect(did).toEqual(["launcher", "voice.hold", "voice.release"]);
  expect(gestures.slice(2)).toEqual(["dashi:down", "dashi:hold", "dashi:up"]);
});

test("a tap of the Dashi key is told to boot whatever asks wait (it asks the capsule whether a card is on screen), and a chord talks to no one", () => {
  const { parts, hub, did, gestures, pass } = started();
  // An ask that is not on screen (a typed plan waiting in the bar) does not take the tap.
  hub.asks.set([{ id: "a1" } as never]);
  parts.key("dashi", true);
  parts.key("dashi", false);
  expect(did).toEqual(["launcher"]);
  expect(gestures).toEqual(["dashi:down", "dashi:tap"]);
  hub.asks.set([]);
  parts.key("dashi", true);
  pass(50);
  parts.key("dashi", false, true);
  expect(did).toEqual(["launcher"]);
  parts.key("dashi", true);
  pass(400);
  parts.key("dashi", false, true);
  expect(did).toEqual(["launcher", "voice.hold", "voice.stop"]);
});

test("the dictation key held types what was heard; 0.8's talk keys are told to the capsule as the Dashi key", async () => {
  const { parts, did, gestures, pass } = started();
  parts.key("dictation", true);
  await settle();
  pass(300);
  await settle();
  parts.key("dictation", false);
  await settle();
  expect(did).toEqual(["type:Hello "]);
  expect(gestures).toEqual(["dictation:down", "dictation:hold", "dictation:up"]);
  parts.key("talk-tap", true);
  parts.key("talk-tap", false);
  expect(gestures.slice(3)).toEqual(["dashi:down", "dashi:tap"]);
  expect(did).toEqual(["type:Hello "]);
});

test("the keys follow the settings live: the layout, the key chosen, dictation off, Voice off", () => {
  const { held, settings, change, parts } = started();
  expect(held).toEqual([["dashi:57", "dictation:100"]]);
  settings.layout = { layout: "es" };
  change();
  expect(held.at(-1)).toEqual(["dashi:57", "dictation:58"]);
  settings.key = "menu";
  change();
  expect(held.at(-1)).toEqual(["dashi:57", "dictation:127"]);
  expect(parts.dictationKey()?.hold).toBe("the Menu key");
  settings.on = false;
  change();
  expect(held.at(-1)).toEqual(["dashi:57"]);
  settings.voiceOn = false;
  change();
  expect(held.at(-1)).toEqual([]);
  change();
  expect(held).toHaveLength(5);
});

test("a tap of the Dashi key does not close a launcher that a tap of ❖ alone just opened", () => {
  expect(tapClosesLauncher(200)).toBe(false);
  expect(tapClosesLauncher(1499)).toBe(false);
  expect(tapClosesLauncher(1500)).toBe(true);
  // No ❖ tap at all: ❖Space closes the launcher it opened, as before.
  expect(tapClosesLauncher(Number.POSITIVE_INFINITY)).toBe(true);
});
