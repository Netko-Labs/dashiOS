/**
 * Dictation (src/dictation/; docs/night-0.9-contract.md, "core"): the key
 * held is a listen, let go it is the words, tidied and typed; what the
 * capsule is told at each step; where nothing is typed; hands-free.
 */

import { expect, test } from "bun:test";
import type { DictationTrouble } from "../src/shared/pill/index.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

test("the key held is a listen; let go, the words are tidied and typed into the window it went down in", async () => {
  const { voice, typed, key, hold, state, phases, hub } = dictating();
  await hold();
  expect(voice.calls).toEqual(["listen"]);
  expect(state()).toMatchObject({ phase: "listening", text: "", handsFree: false, hint: null });
  voice.emit({ event: "level", level: 0.4 });
  expect(hub.level.getSnapshot()).toBe(0.4);
  voice.emit({ event: "partial", text: "Um hello" });
  expect(state()).toMatchObject({ phase: "listening", text: "Um hello" });
  await key("up");
  expect(voice.calls).toEqual(["listen", "listen.stop"]);
  expect(typed).toEqual(["7:Hello there."]);
  expect(state()).toMatchObject({ phase: "landed", typed: "Hello there.", heard: "Um, hello there.", line: "Typed. 1 filler out." });
  expect(phases()).toEqual(["key-down", "opening", "listening", "listening", "tidying", "landed"]);
  expect(hub.level.getSnapshot()).toBe(0);
});

test("landed goes away by itself, and the first listen teaches the key once", async () => {
  const { timers, key, hold, state } = dictating({ taught: false });
  await hold();
  expect(state()).toMatchObject({ phase: "listening", hint: "Hold to dictate. Let go to type." });
  await key("up");
  expect(state().phase).toBe("landed");
  timers.advance(6000);
  expect(state()).toEqual({ phase: "idle" });
  await hold();
  expect(state()).toMatchObject({ phase: "listening", hint: null });
});

test("a tap shows nothing more, and a chord heard nothing", async () => {
  const { voice, typed, key, hold, state } = dictating();
  await key("down");
  expect(state()).toEqual({ phase: "key-down" });
  await key("tap");
  expect(state()).toEqual({ phase: "idle" });
  expect(voice.calls).toEqual([]);
  await hold();
  await key("chord");
  expect(voice.calls).toEqual(["listen", "listen.cancel"]);
  expect(state()).toEqual({ phase: "idle" });
  expect(typed).toEqual([]);
});

test("a password field never opens the microphone", async () => {
  const { voice, world, hold, state } = dictating();
  world.secret = true;
  await hold();
  expect(voice.calls).toEqual([]);
  expect(state()).toMatchObject({ phase: "notice", trouble: "secret" });
});

test("what stops the microphone is said, and it is never called listening", async () => {
  for (const [set, trouble, line] of [
    [(w: { trouble: DictationTrouble | null }) => void (w.trouble = "no-model"), "no-model", "Dictation needs its models. See Settings › Voice."],
    [(w: { trouble: DictationTrouble | null }) => void (w.trouble = "loading"), "loading", "Voice is starting. Press again in a moment."],
    [(w: { muted: boolean }) => void (w.muted = true), "muted", "The microphone is muted."],
    [(w: { busy: boolean }) => void (w.busy = true), "busy", "Dashi is listening already."],
  ] as const) {
    const { voice, world, hold, state, phases } = dictating();
    set(world);
    await hold();
    expect(voice.calls).toEqual([]);
    expect(state()).toMatchObject({ phase: "notice", trouble, line });
    expect(phases()).not.toContain("listening");
  }
  const { voice, hold, state, phases } = dictating();
  voice.replies.listen = new Error("The microphone gave no sound. Check the input in Sound settings.");
  await hold();
  expect(state()).toMatchObject({ phase: "notice", trouble: "no-microphone" });
  expect(phases()).not.toContain("listening");
});

test("no field: nothing is typed and the words wait with Copy", async () => {
  const { typed, world, key, hold, state, hub, timers } = dictating();
  await hold();
  world.front = null;
  await key("up");
  expect(typed).toEqual([]);
  expect(state()).toMatchObject({ phase: "waiting", reason: "no-field", text: "Hello there.", heard: "Um, hello there." });
  hub.dictationCommands.send({ do: "copy" });
  await settle();
  expect(world.copied).toEqual(["Hello there."]);
  expect(state()).toEqual({ phase: "idle" });
  // Not copied, they wait ten minutes.
  world.front = { window: 7, pid: 70 };
  await hold();
  world.front = { window: 9, pid: 90 };
  await key("up");
  expect(state()).toMatchObject({ phase: "waiting", reason: "left-window" });
  timers.advance(599_000);
  expect(state().phase).toBe("waiting");
  timers.advance(1000);
  expect(state()).toEqual({ phase: "idle" });
});

test("where typing can't be done the words are pasted and the line says so; where neither, they wait", async () => {
  const pasted = dictating();
  pasted.world.refuse = "x11";
  await pasted.hold();
  await pasted.key("up");
  expect(pasted.typed).toEqual(["paste 7:Hello there."]);
  expect(pasted.state()).toMatchObject({ phase: "landed", line: "Pasted. 1 filler out." });
  const failed = dictating();
  failed.world.refuse = "x11";
  failed.world.pastes = false;
  await failed.hold();
  await failed.key("up");
  expect(failed.state()).toMatchObject({ phase: "waiting", reason: "failed" });
  const left = dictating();
  left.world.refuse = "left-window";
  await left.hold();
  await left.key("up");
  expect(left.typed).toEqual([]);
  expect(left.state()).toMatchObject({ phase: "waiting", reason: "left-window" });
});

test("a key the person still holds is waited out, then the words are typed", async () => {
  const { typed, world, key, hold, timers, state } = dictating();
  await hold();
  world.refuse = "keys-down";
  await key("up");
  expect(typed).toEqual([]);
  world.refuse = null;
  timers.advance(150);
  await settle();
  expect(typed).toEqual(["7:Hello there."]);
  expect(state().phase).toBe("landed");
});

test("nothing said: one line, nothing typed; a held key with nothing said ends by itself", async () => {
  const quiet = dictating({ heard: "" });
  await quiet.hold();
  await quiet.key("up");
  expect(quiet.typed).toEqual([]);
  expect(quiet.state()).toMatchObject({ phase: "notice", trouble: "nothing-said" });
  const held = dictating();
  await held.hold();
  held.timers.advance(30_000);
  await settle();
  expect(held.voice.calls).toEqual(["listen", "listen.cancel"]);
  expect(held.state()).toMatchObject({ phase: "notice", trouble: "nothing-said" });
});

test("while the bar's row is the field the words go to it", async () => {
  const { typed, hub, key, hold, state } = dictating();
  const inserted: string[] = [];
  hub.bar.set({ mode: "field", text: "" });
  hub.barCommands.handle((command) => {
    if (command.do === "insert") inserted.push(command.text);
  });
  await hold();
  await key("up");
  expect(inserted).toEqual(["Hello there."]);
  expect(typed).toEqual([]);
  expect(state().phase).toBe("landed");
});

test("tidying off types the words as heard; Type it instead lands words as a dictation would", async () => {
  const { typed, world, hub, key, hold, state } = dictating();
  world.tidy = false;
  await hold();
  await key("up");
  expect(typed).toEqual(["7:Um, hello there."]);
  world.tidy = true;
  hub.dictationCommands.send({ do: "type", text: "uh, open the calendar" });
  await settle();
  expect(typed.at(-1)).toBe("7:Open the calendar");
  expect(state()).toMatchObject({ phase: "landed", line: "Typed. 1 filler out." });
});

test("off, the key does nothing", async () => {
  const { voice, world, hold, state } = dictating();
  world.on = false;
  await hold();
  expect(voice.calls).toEqual([]);
  expect(state()).toEqual({ phase: "idle" });
});
