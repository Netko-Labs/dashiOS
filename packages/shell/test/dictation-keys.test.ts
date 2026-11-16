/**
 * The two keys (src/dictation/keys.ts, lib/gestures.ts, start.ts;
 * docs/night-0.9-contract.md, "core"): what a press turned out to be, which
 * key dictates on which layout, and what the Dashi key does.
 */

import { expect, test } from "bun:test";
import { tapClosesLauncher } from "../src/dictation/keys.ts";
import { type DictationOptions, startDictation } from "../src/dictation/start.ts";
import { createPillHub, type DictationKeyId } from "../src/shared/pill/index.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

function started() {
  const voice = fakeVoice({ "listen.stop": { text: "hello", speech_ms: 500 } });
  const timers = handTimers();
  const hub = createPillHub();
  const clock = { now: 0 };
  const did: string[] = [];
  const checked: number[] = [];
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
    secret: async (front) => {
      checked.push(front.window);
      return null;
    },
    field: async () => null,
    sendKeys: async () => {},
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
  return { parts, hub, did, checked, held, gestures, settings, pass, change, voice };
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

// Seen once in the smoke pass: the first "Type it instead" after logging in typed nothing (11-agents, D122).
test("holding the Dashi key warms the field check, so words typed instead do not wait on it at the landing", async () => {
  const { parts, checked, pass } = started();
  parts.key("dashi", true);
  pass(100);
  parts.key("dashi", false);
  await settle();
  // A tap is the launcher's: nothing is checked.
  expect(checked).toEqual([]);
  parts.key("dashi", true);
  pass(300);
  await settle();
  expect(checked).toEqual([7]);
});

test("with Voice off the dictation key says once what dictation needs, then stays quiet; a key that would be taken is never asked for", () => {
  const { parts, hub, held, gestures, settings, pass, change } = started();
  settings.voiceOn = false;
  change();
  // The right ⌥ is still heard (held alone, never taken from the app); the Dashi key is not.
  expect(held.at(-1)).toEqual(["dictation:100"]);
  // A tap says nothing.
  parts.key("dictation", true);
  pass(50);
  parts.key("dictation", false);
  expect(hub.dictation.getSnapshot().phase).toBe("idle");
  // A hold: one line that names Settings › Voice, and the key is let go of.
  pass(1000);
  parts.key("dictation", true);
  pass(400);
  expect(hub.dictation.getSnapshot()).toMatchObject({ phase: "notice", trouble: "voice-off", line: "Dictation needs Voice turned on. See Settings › Voice." });
  expect(held.at(-1)).toEqual([]);
  // No gesture was told to the capsule's other parts: nothing listens.
  expect(gestures).toEqual([]);
  // The line goes by itself, and a second hold in the same session says nothing: the key is no longer heard.
  parts.key("dictation", false);
  pass(10_000);
  expect(hub.dictation.getSnapshot().phase).toBe("idle");
  change();
  expect(held.at(-1)).toEqual([]);
  // Dictation turned off: nothing to say, nothing held.
  const { held: quiet, settings: off, change: again } = started();
  off.voiceOn = false;
  off.on = false;
  again();
  expect(quiet.at(-1)).toEqual([]);
  // Caps Lock (a Spanish layout) would be taken from the person: not asked for while Voice is off.
  const { held: caps, settings: spanish, change: more } = started();
  spanish.voiceOn = false;
  spanish.layout = { layout: "es" };
  more();
  expect(caps.at(-1)).toEqual([]);
});

// Pass 37 (failure 3): Voice turned on while the session ran, by settings.json or Settings › Voice's switch (both reach
// the shell as a settings change); holding ❖Space must talk at once, with no restart. In the VM both ways worked first time.
test("Voice turned on mid-session: the Dashi key is held at once, and its hold talks to Dashi", () => {
  const { parts, did, held, settings, pass, change } = started();
  settings.voiceOn = false;
  change();
  expect(held.at(-1)).not.toContain("dashi:57");
  settings.voiceOn = true;
  change();
  expect(held.at(-1)).toContain("dashi:57");
  parts.key("dashi", true);
  pass(400);
  parts.key("dashi", false);
  expect(did).toEqual(["voice.hold", "voice.release"]);
});
