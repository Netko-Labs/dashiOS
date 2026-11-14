/**
 * Hands-free dictation (src/dictation/lib/hands-free.ts): a double tap, a
 * sentence landing at each pause, and how it ends, never silently.
 */

import { expect, test } from "bun:test";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

test("hands-free: a double tap; each sentence lands at its pause; a tap ends it, heard", async () => {
  const { voice, typed, world, key, state } = dictating({ heard: "" });
  await key("down");
  await key("tap");
  await key("double-tap");
  expect(voice.calls).toEqual(["listen"]);
  expect(state()).toMatchObject({ phase: "listening", handsFree: true, endsAt: 1000 + 600_000 });
  voice.emit({ event: "partial", text: "First" });
  voice.emit({ event: "heard", text: "First sentence." });
  await settle();
  expect(typed).toEqual(["7:First sentence. "]);
  expect(voice.calls).toEqual(["listen", "listen"]);
  voice.emit({ event: "heard", text: "um second one." });
  await settle();
  expect(typed).toEqual(["7:First sentence. ", "7:Second one. "]);
  expect(state()).toMatchObject({ phase: "listening", handsFree: true, text: "" });
  await key("down");
  await key("tap");
  expect(voice.calls.at(-1)).toBe("listen.stop");
  expect(world.chimes).toBe(1);
  expect(state()).toMatchObject({ phase: "notice", trouble: "ended", line: "Hands-free ended." });
});

test("hands-free ends by itself, never silently: another window, quiet, the limit", async () => {
  const moved = dictating({ heard: "" });
  await moved.key("double-tap");
  moved.world.front = { window: 9, pid: 90 };
  moved.voice.emit({ event: "partial", text: "And" });
  await settle();
  expect(moved.world.chimes).toBe(1);
  expect(moved.state()).toMatchObject({ phase: "notice", trouble: "ended" });
  const quiet = dictating({ heard: "" });
  await quiet.key("double-tap");
  quiet.timers.advance(20_000);
  await settle();
  expect(quiet.world.chimes).toBe(1);
  expect(quiet.state()).toMatchObject({ phase: "notice", trouble: "ended" });
  const long = dictating({ heard: "the last words" });
  await long.key("double-tap");
  for (let passed = 0; passed < 600_000; passed += 10_000) {
    long.voice.emit({ event: "partial", text: "still talking" });
    long.timers.advance(10_000);
  }
  await settle();
  expect(long.typed).toEqual(["7:The last words "]);
  expect(long.world.chimes).toBe(1);
  expect(long.state()).toMatchObject({ phase: "notice", trouble: "limit", line: "Hands-free ended: the time limit." });
});

test("hands-free off: a double tap opens nothing", async () => {
  const { voice, world, key, state } = dictating();
  world.handsFree = false;
  await key("double-tap");
  expect(voice.calls).toEqual([]);
  expect(state()).toEqual({ phase: "idle" });
});

test("hands-free: a click in the window while a sentence is said keeps it out; the tap that ends it does not", async () => {
  const { voice, typed, world, key, state } = dictating({ heard: "the rest." });
  await key("double-tap");
  // Return pressed to send the last message, then the next is said: it lands.
  world.pressed = 0;
  world.now += 500;
  voice.emit({ event: "partial", text: "Next" });
  world.now += 2000;
  world.pressed = 2500;
  voice.emit({ event: "heard", text: "Next one." });
  await settle();
  expect(typed).toEqual(["7:Next one. "]);
  // The ending tap is a key in the window too, and what was being said still lands.
  world.now += 1000;
  voice.emit({ event: "partial", text: "the" });
  world.now += 1000;
  world.pressed = 0;
  await key("tap");
  expect(typed).toEqual(["7:Next one. ", "7:The rest. "]);
  expect(state()).toMatchObject({ phase: "notice", trouble: "ended" });

  const moved = dictating({ heard: "" });
  await moved.key("double-tap");
  moved.voice.emit({ event: "partial", text: "For" });
  moved.world.now += 1500;
  moved.world.pressed = 400;
  moved.voice.emit({ event: "heard", text: "For Marta." });
  await settle();
  expect(moved.typed).toEqual([]);
  expect(moved.world.chimes).toBe(1);
  expect(moved.state()).toMatchObject({ phase: "waiting", reason: "moved", text: "For Marta." });
});
