/**
 * The insertion record (src/dictation/lib/record.ts, erase.ts, after.ts;
 * history.ts): what Dashi typed is remembered, Undo takes back exactly it
 * and only while the field still ends with it, Raw lands the recogniser's
 * words instead, "paste last" types it again, and the history keeps the raw
 * and the final words for as long as the person says.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DictationHistory } from "../src/dictation/index.ts";
import { eraseCount } from "../src/dictation/lib/erase.ts";
import type { HistoryKeep } from "../src/shared/pill/index.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

const backspaces = (keys: readonly string[]): number => keys.filter((key) => key.endsWith(":BackSpace")).length;

test("Undo takes back exactly what was typed, where the field still ends with it", async () => {
  const { hub, world, keys, hold, key, state } = dictating();
  world.before = "Dear Alex. ";
  await hold();
  await key("up");
  expect(state()).toMatchObject({ phase: "landed", typed: "Hello there.", undo: true, raw: true });
  expect(world.before).toBe("Dear Alex. Hello there. ");
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(backspaces(keys)).toBe("Hello there. ".length);
  expect(world.before).toBe("Dear Alex. ");
  expect(state()).toMatchObject({ phase: "told", tone: "ok", line: "Removed 2 words." });
  // Nothing is left to take back: the person's own text is never touched.
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(world.before).toBe("Dear Alex. ");
  expect(state()).toMatchObject({ phase: "told", tone: "warn", line: "Nothing of mine to take back." });
});

test("Undo leaves a field that changed alone, and says so", async () => {
  const { hub, world, keys, hold, key, state } = dictating();
  world.before = "";
  await hold();
  await key("up");
  world.before = "Hello there. And more";
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(keys).toEqual([]);
  expect(state()).toMatchObject({ phase: "told", tone: "warn", line: "That text has changed, so I left it." });
});

test("where the field can't be read, Undo goes only if the person pressed nothing there since", async () => {
  const first = dictating();
  await first.hold();
  await first.key("up");
  first.world.now += 2000;
  first.hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(backspaces(first.keys)).toBe("Hello there. ".length);

  const second = dictating();
  await second.hold();
  await second.key("up");
  second.world.now += 2000;
  // A key in the window one second ago, after the words landed.
  second.world.pressed = 1000;
  second.hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(second.keys).toEqual([]);
  expect(second.state()).toMatchObject({ phase: "told", tone: "warn" });
});

test("Undo in another window does nothing", async () => {
  const { hub, world, keys, hold, key, state } = dictating();
  await hold();
  await key("up");
  world.front = { window: 9, pid: 90 };
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(keys).toEqual([]);
  expect(state()).toMatchObject({ phase: "told", tone: "warn", line: "Nothing of mine to take back." });
});

test("Raw lands the recogniser's words in place of the tidied ones", async () => {
  const { hub, world, typed, hold, key, state } = dictating();
  world.before = "";
  await hold();
  await key("up");
  hub.dictationCommands.send({ do: "raw" });
  await settle();
  expect(world.before).toBe("Um, hello there. ");
  expect(typed.at(-1)).toBe("7:Um, hello there. ");
  expect(state()).toMatchObject({ phase: "landed", typed: "Um, hello there.", line: "Typed. As you said it.", raw: false, undo: true });
});

test("paste last types the last dictation again, also one that never landed", async () => {
  const { hub, world, typed, hold, key, state } = dictating();
  world.front = null;
  await hold();
  world.front = null;
  await key("up");
  expect(state()).toMatchObject({ phase: "waiting", reason: "no-field" });
  world.front = { window: 9, pid: 90 };
  hub.dictationCommands.send({ do: "paste-last" });
  await settle();
  expect(typed).toEqual(["9:Hello there. "]);
  expect(state()).toMatchObject({ phase: "landed", line: "Typed. Your last dictation." });
});

test("how many BackSpaces: the whole of it, or the words when the app dropped the last space", () => {
  expect(eraseCount("Hello. ", "Dear Alex, Hello. ")).toBe(7);
  expect(eraseCount("Hello. ", "Dear Alex, Hello.")).toBe(6);
  expect(eraseCount("Hello. ", "Dear Alex, Hello. x")).toBeNull();
  expect(eraseCount("ñandú ", "el ñandú ")).toBe(6);
});

function history(keep: HistoryKeep = "day") {
  const file = join(mkdtempSync(join(tmpdir(), "dashi-history-")), "history.jsonl");
  const world = { keep, now: 1_000_000_000 };
  const make = () => new DictationHistory({ file, keep: () => world.keep, now: () => world.now });
  return { file, world, make, store: make() };
}

const entry = (id: string, at: number) => ({ id, at, app: "Text Editor", profile: "Writing", heard: `um ${id}`, typed: id });

test("the history keeps raw and final words for a day, the newest first, for the person alone", () => {
  const { file, world, make, store } = history();
  store.add(entry("one", world.now));
  world.now += 3_600_000;
  store.add(entry("two", world.now));
  expect(store.getSnapshot().map((each) => each.id)).toEqual(["two", "one"]);
  expect(make().getSnapshot()[1]).toMatchObject({ heard: "um one", typed: "one", app: "Text Editor" });
  expect(Bun.file(file).size).toBeGreaterThan(0);
  expect((require("node:fs").statSync(file).mode & 0o777).toString(8)).toBe("600");
  // A day after the first, it is gone at the next landing.
  world.now += 23 * 3_600_000;
  store.add(entry("three", world.now));
  expect(store.getSnapshot().map((each) => each.id)).toEqual(["three", "two"]);
  store.remove("two");
  expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
});

test("keep nothing writes nothing and removes what was kept", () => {
  const { file, world, store } = history();
  store.add(entry("one", world.now));
  world.keep = "none";
  store.refresh();
  expect(store.getSnapshot()).toEqual([]);
  expect(require("node:fs").existsSync(file)).toBe(false);
  store.add(entry("two", world.now));
  expect(store.getSnapshot()).toEqual([]);
});

test("a landing goes to the history with its raw words, and Undo marks it", async () => {
  const { store } = history();
  const { hub, hold, key } = dictating({ history: store });
  await hold();
  await key("up");
  expect(store.getSnapshot()[0]).toMatchObject({ heard: "Um, hello there.", typed: "Hello there." });
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(store.getSnapshot()[0]).toMatchObject({ after: "undone" });
});
