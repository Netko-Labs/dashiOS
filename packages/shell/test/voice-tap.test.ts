/**
 * The Copilot key (voice/voice.ts, voice/lib/tap-listen.ts): many laptops send its press and release
 * together, so it can't be held. A tap of it starts a listen that ends when the person stops talking,
 * or at the next tap; held, it is a hold like any other key. And the speaking model is loaded as a
 * talk key goes down, so the answer never waits for it.
 */

import { expect, test } from "bun:test";
import { STOP, TALK, TALK_TAP, TAP_QUIET_MS, TAP_WAIT_MS, talkKey } from "../src/voice/keys.ts";
import type { Chip } from "../src/voice/types.ts";
import { Voice } from "../src/voice/voice.ts";
import { settle } from "./support/time.ts";
import { fakeVoice, handTimers } from "./support/voice.ts";

function talking() {
  const voice = fakeVoice({ "listen.stop": { text: "Open the calendar.", speech_ms: 900 }, speak: { id: 7 } });
  const timers = handTimers();
  const asked: string[] = [];
  const quiet: unknown[] = [];
  voice.replies["listen.quiet"] = (params: Record<string, unknown>) => {
    quiet.push(params.quiet_ms);
    return {};
  };
  const state = { now: 1000 };
  const talk = new Voice({
    service: voice.service,
    prefs: () => ({ on: true, key: talkKey(undefined), voice: undefined }),
    trouble: () => null,
    hold: () => {},
    asker: {
      ask: (words) => {
        asked.push(words);
        return Promise.resolve({ say: "Here it is." });
      },
    },
    timers,
    now: () => state.now,
  });
  const chip = (): Chip | null => talk.getSnapshot();
  /** The key `name` down, and up `ms` later. */
  const press = async (name: string, ms: number): Promise<void> => {
    talk.key(name, true);
    await settle();
    state.now += ms;
    talk.key(name, false);
    await settle();
  };
  return { voice, timers, asked, quiet, talk, chip, press };
}

test("a tap of the Copilot key starts a listen that ends by itself when the person stops talking", async () => {
  const { voice, asked, quiet, chip, press } = talking();
  // Down and up together, as the firmware sends them.
  await press(TALK_TAP, 0);
  expect(voice.calls).toEqual(["listen", "warm", "listen.quiet"]);
  expect(quiet).toEqual([TAP_QUIET_MS]);
  expect(chip()).toEqual({ kind: "listening", text: "", question: false });
  voice.emit({ event: "partial", text: "What's the" });
  expect(chip()).toEqual({ kind: "listening", text: "What's the", question: false });
  // The person went quiet: the service ended the listen and says what it heard.
  voice.emit({ event: "heard", text: "What's the weather? " });
  await settle();
  expect(asked).toEqual(["What's the weather?"]);
  expect(voice.calls.at(-1)).toBe("speak:Here it is.");
  expect(voice.calls).not.toContain("listen.stop");
  expect(voice.calls).not.toContain("listen.cancel");
});

test("the next tap ends it sooner, as letting go of a held key does", async () => {
  const { voice, asked, chip, press } = talking();
  await press(TALK_TAP, 20);
  expect(chip()?.kind).toBe("listening");
  await press(TALK_TAP, 20);
  expect(voice.calls).toEqual(["listen", "warm", "listen.quiet", "listen.stop", "speak:Here it is."]);
  expect(asked).toEqual(["Open the calendar."]);
  // The words `listen.stop` answered with are not asked twice when its `heard` event comes too.
  voice.emit({ event: "heard", text: "Open the calendar." });
  await settle();
  expect(asked).toEqual(["Open the calendar."]);
});

test("nothing said after a tap: the microphone is closed and the chip says so", async () => {
  const { voice, timers, asked, chip, press } = talking();
  await press(TALK_TAP, 0);
  timers.advance(TAP_WAIT_MS - 1);
  expect(chip()?.kind).toBe("listening");
  timers.advance(1);
  await settle();
  expect(voice.calls.at(-1)).toBe("listen.cancel");
  expect(chip()).toEqual({ kind: "notice", text: "I didn't hear anything." });
  expect(asked).toEqual([]);
  // The listen that ends by itself with no words says the same.
  await press(TALK_TAP, 0);
  voice.emit({ event: "heard", text: "" });
  await settle();
  expect(chip()).toEqual({ kind: "notice", text: "I didn't hear anything." });
  expect(asked).toEqual([]);
});

test("words under way are not given up on: the wait is for a first word only", async () => {
  const { voice, timers, chip, press } = talking();
  await press(TALK_TAP, 0);
  voice.emit({ event: "partial", text: "Tell me about" });
  timers.advance(TAP_WAIT_MS);
  await settle();
  expect(chip()).toEqual({ kind: "listening", text: "Tell me about", question: false });
  expect(voice.calls).not.toContain("listen.cancel");
});

test("held, the Copilot key is a hold; and a tap of a key that can be held still only says how", async () => {
  const { voice, asked, chip, press } = talking();
  await press(TALK_TAP, 1200);
  expect(voice.calls).toEqual(["listen", "warm", "listen.stop", "speak:Here it is."]);
  expect(asked).toEqual(["Open the calendar."]);
  const second = talking();
  await second.press(TALK, 50);
  expect(second.voice.calls).toEqual(["listen", "warm", "listen.cancel"]);
  expect(second.chip()).toEqual({ kind: "notice", text: "Hold ❖Space or the Copilot key to talk." });
  expect(chip()).not.toBeNull();
});

test("Esc ends a tap's listen at once, and a tap while Dashi speaks only stops it", async () => {
  const { voice, asked, talk, chip, press } = talking();
  await press(TALK_TAP, 0);
  talk.key(STOP, true);
  await settle();
  expect(voice.calls.at(-1)).toBe("listen.cancel");
  expect(chip()).toBeNull();
  // Its late words are nobody's.
  voice.emit({ event: "heard", text: "Too late." });
  await settle();
  expect(asked).toEqual([]);
  // Dashi speaks; a tap stops it and listens to nothing.
  await talk.say("A long answer.");
  const before = voice.calls.length;
  await press(TALK_TAP, 0);
  expect(voice.calls.slice(before)).toEqual(["speak.stop", "listen", "warm", "listen.cancel"]);
  expect(chip()).toBeNull();
});

test("the speaking model loads as the key goes down, but not for an agent's question, which gets no spoken answer", async () => {
  const { voice, talk, press } = talking();
  talk.key(TALK, true);
  await settle();
  expect(voice.calls).toEqual(["listen", "warm"]);
  talk.key(STOP, true);
  await settle();
  const answers: string[] = [];
  talk.ask("Claude asks: Which calendar?", (text) => answers.push(text));
  await settle();
  const before = voice.calls.length;
  await press(TALK, 900);
  expect(voice.calls.slice(before)).toEqual(["speak.stop", "listen", "listen.stop"]);
  expect(answers).toEqual(["Open the calendar."]);
});

test("Settings › Voice says how a tap of the Copilot key talks, beside the key that has it", () => {
  expect(talkKey(undefined).tap).toBe("A Copilot key that can't be held: tap it, talk, then stop talking or tap it again.");
  for (const id of ["right-option", "right-control", "caps-lock", "menu"] as const) expect(talkKey(id).tap).toBeUndefined();
});
