/** Lists and whole-utterance instructions by rule (src/dictation/lib/lists.ts, instruction.ts). */

import { expect, test } from "bun:test";
import { instructionOf } from "../src/dictation/lib/instruction.ts";
import { makeList } from "../src/dictation/lib/lists.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

const list = (text: string, style: "markdown" | "plain" = "markdown") => makeList(text, style)?.text ?? null;

test("first… second… third… is a numbered list, with what came before as its introduction", () => {
  expect(list("Here's the plan. First, buy milk. Second, call Alex. Third, sleep.")).toBe("Here's the plan:\n1. Buy milk\n2. Call Alex\n3. Sleep");
  expect(list("first buy milk second call Alex and third sleep")).toBe("1. Buy milk\n2. Call Alex\n3. Sleep");
  expect(list("Primero, comprar leche. Segundo, llamar a Alex.")).toBe("1. Comprar leche\n2. Llamar a Alex");
  // An ordinal that describes is not a marker.
  expect(list("The first time I saw the second movie I slept.")).toBeNull();
  expect(list("At first I thought so, but on second thoughts no.")).toBeNull();
  expect(list("First we eat.")).toBeNull();
});

test("one, two, three count a list only when each stands at a start; bullet points make bullets", () => {
  expect(list("We need three things: one, milk. Two, bread. Three, eggs.")).toBe("We need three things:\n1. Milk\n2. Bread\n3. Eggs");
  expect(list("I have one or two ideas and three hours.")).toBeNull();
  expect(list("Shopping. Bullet point milk, bullet point bread, next item eggs.")).toBe("Shopping:\n- Milk\n- Bread\n- Eggs");
  expect(list("bullet point milk bullet point bread", "plain")).toBe("Milk\nBread");
  expect(list("Viñeta leche, viñeta pan.")).toBe("- Leche\n- Pan");
  expect(list("Use a bullet point here.")).toBeNull();
});

test("an instruction is the whole utterance, in English or Spanish; inside a sentence the words are words", () => {
  for (const said of ["Scratch that.", "scratch that", "Um, delete that.", "Undo that, please.", "Remove the previous text.", "Borra eso.", "Quita eso"]) {
    expect(instructionOf(said)).toEqual({ kind: "erase" });
  }
  expect(instructionOf("New line.")).toEqual({ kind: "break", text: "\n" });
  expect(instructionOf("Nueva línea")).toEqual({ kind: "break", text: "\n" });
  expect(instructionOf("New paragraph")).toEqual({ kind: "break", text: "\n\n" });
  expect(instructionOf("Tell him to scratch that idea.")).toBeNull();
  expect(instructionOf("Scratch that, I meant Tuesday.")).toBeNull();
  expect(instructionOf("We should remove the previous text from the page.")).toBeNull();
  expect(instructionOf("")).toBeNull();
});

test("scratch that, said alone, takes back the last dictation; Undo puts it back and types the words instead", async () => {
  const { voice, hub, world, hold, key, state } = dictating({ heard: "See you tomorrow." });
  world.before = "";
  await hold();
  await key("up");
  expect(world.before).toBe("See you tomorrow. ");
  voice.replies["listen.stop"] = { text: "Scratch that.", speech_ms: 400 };
  await hold();
  await key("up");
  expect(world.before).toBe("");
  expect(state()).toMatchObject({ phase: "told", tone: "ok", line: "Took that as an instruction. Removed 3 words.", undo: true });
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(world.before).toBe("See you tomorrow. Scratch that. ");
  expect(state()).toMatchObject({ phase: "landed", line: "Typed. As you said it." });
});

test("scratch that walks back through what Dashi typed, and never touches the person's own text", async () => {
  const { voice, world, keys, hold, key, state } = dictating({ heard: "One thing." });
  world.before = "Mine. ";
  await hold();
  await key("up");
  voice.replies["listen.stop"] = { text: "Another thing.", speech_ms: 400 };
  await hold();
  await key("up");
  expect(world.before).toBe("Mine. One thing. Another thing. ");
  voice.replies["listen.stop"] = { text: "Scratch that.", speech_ms: 400 };
  await hold();
  await key("up");
  expect(world.before).toBe("Mine. One thing. ");
  await hold();
  await key("up");
  expect(world.before).toBe("Mine. ");
  const before = keys.length;
  await hold();
  await key("up");
  expect(keys.length).toBe(before);
  expect(world.before).toBe("Mine. ");
  expect(state()).toMatchObject({ phase: "told", tone: "warn", line: "Nothing of mine to take back." });
});

test("inside a longer sentence the same words are typed", async () => {
  const { typed, hold, key } = dictating({ heard: "Tell him to scratch that idea." });
  await hold();
  await key("up");
  expect(typed).toEqual(["7:Tell him to scratch that idea. "]);
});

test("new line, said alone, is an instruction: ⇧Return where Return sends", async () => {
  const { world, typed, keys, hold, key, state } = dictating({ heard: "New line." });
  world.front = { window: 7, pid: 70, appId: "helium" };
  world.site = "web.whatsapp.com";
  world.before = "Hello";
  await hold();
  await key("up");
  expect(keys).toEqual(["7:shift+Return"]);
  expect(typed).toEqual([]);
  expect(state()).toMatchObject({ phase: "told", line: "Took that as an instruction. A new line." });
});

test("a list lands as Markdown in a chat with ⇧Return between its lines, and as plain lines in a document", async () => {
  const said = "First buy milk second call Alex third sleep";
  const chat = dictating({ heard: said });
  chat.world.front = { window: 7, pid: 70, appId: "helium" };
  chat.world.site = "web.whatsapp.com";
  await chat.hold();
  await chat.key("up");
  expect(chat.typed).toEqual(["7:1. Buy milk", "7:2. Call Alex", "7:3. Sleep "]);
  expect(chat.keys).toEqual(["7:shift+Return", "7:shift+Return"]);
  expect(chat.state()).toMatchObject({ phase: "landed", line: "Typed. A list of 3.", profile: "Chat" });

  const document = dictating({ heard: "Shopping. Bullet point milk, bullet point bread." });
  document.world.front = { window: 7, pid: 70, appId: "dev.dashi.editor" };
  await document.hold();
  await document.key("up");
  expect(document.typed).toEqual(["7:Shopping:\nMilk\nBread "]);

  // A shell's prompt gets no list: a line break there runs what was typed.
  const shell = dictating({ heard: said });
  shell.world.front = { window: 7, pid: 70, appId: "dev.dashi.terminal" };
  await shell.hold();
  await shell.key("up");
  expect(shell.typed).toEqual(["7:first buy milk second call Alex third sleep "]);
});
