/** Fitting the words to the field (src/dictation/lib/fit.ts): a space, a capital and a full stop only where they belong. */

import { expect, test } from "bun:test";
import { NO_WORDS, wordsFrom } from "../src/dictation/index.ts";
import { continues, fit } from "../src/dictation/lib/fit.ts";
import { dictating } from "./support/dictation.ts";
import { settle } from "./support/time.ts";

const words = wordsFrom(["the\nis\nhello\nwe\nmeet\ntomorrow\nand\nthen\nit\nwork/S\nAlex"]);
const fitting = { words, names: new Set(["dashi"]) };
const typed = (text: string, before: string | null, after: string | null = "") => fit(text, { before, after }, fitting).typed;

test("where the field can't be read the words land as said, with a space after", () => {
  expect(typed("Hello there.", null)).toBe("Hello there. ");
  expect(fit("Hello there.", null, fitting).typed).toBe("Hello there. ");
  expect(typed("Line\n", null)).toBe("Line\n");
});

test("a leading space only where one is needed", () => {
  expect(typed("Hello.", "")).toBe("Hello. ");
  expect(typed("Hello.", "Dear Alex.")).toBe(" Hello. ");
  expect(typed("Hello.", "Dear Alex. ")).toBe("Hello. ");
  expect(typed("Hello.", "Dear Alex.\n")).toBe("Hello. ");
  expect(typed("Hello.", "He said “")).toBe("hello. ");
  expect(typed("Hello.", "path/")).toBe("hello. ");
});

test("a lone list item starts its own line, unless the caret already starts one", () => {
  expect(typed("\n- Passport", "Things to pack")).toBe("\n- Passport ");
  expect(typed("\n- Passport", "Things to pack:\n")).toBe("- Passport ");
  expect(typed("\n• Passport", "")).toBe("• Passport ");
  // A line break said alone stays one.
  expect(typed("\nThanks", "")).toBe("\nThanks ");
});

test("continuing a sentence: no capital, unless the word is a name", () => {
  expect(typed("And then it works.", "We meet tomorrow, ")).toBe("and then it works. ");
  expect(typed("And then it works.", "We meet tomorrow. ")).toBe("And then it works. ");
  expect(typed("Alex said so.", "we asked and ")).toBe("Alex said so. ");
  expect(typed("Dashi does that.", "we asked and ")).toBe("Dashi does that. ");
  expect(typed("I think so.", "and ")).toBe("I think so. ");
  expect(typed("We meet.", "Note: ")).toBe("We meet. ");
  // With no dictionary an unknown word is still lower-cased unless the vocabulary names it.
  expect(fit("Tomorrow then.", { before: "see you ", after: "" }, { words: NO_WORDS, names: new Set() }).typed).toBe("tomorrow then. ");
  expect(continues("Hello there.\nand")).toBe(true);
  expect(continues("Hello there.\n")).toBe(false);
  expect(continues("Is it? ")).toBe(false);
});

test("mid-line: no full stop of ours before the text that follows, and no second space", () => {
  expect(typed("Tomorrow.", "We meet ", " at noon.")).toBe("tomorrow");
  expect(typed("Tomorrow.", "We meet ", "at noon.")).toBe("tomorrow ");
  expect(typed("Tomorrow.", "We meet ", ".")).toBe("tomorrow");
  expect(typed("Is it?", "We meet ", " at noon.")).toBe("Is it?".replace("Is", "is"));
  // The next line is not a continuation.
  expect(typed("Tomorrow.", "We meet ", "\nNext line")).toBe("tomorrow. ");
});

test("a dictation continues the line it lands in, and Undo takes back exactly that", async () => {
  const { hub, world, typed: sent, hold, key, state } = dictating({ heard: "And then we meet.", words });
  world.before = "We work tomorrow,";
  world.after = "";
  await hold();
  await key("up");
  expect(sent).toEqual(["7: and then we meet. "]);
  expect(state()).toMatchObject({ phase: "landed", typed: "and then we meet." });
  expect(world.before).toBe("We work tomorrow, and then we meet. ");
  hub.dictationCommands.send({ do: "undo" });
  await settle();
  expect(world.before).toBe("We work tomorrow,");
});
