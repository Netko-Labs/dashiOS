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
