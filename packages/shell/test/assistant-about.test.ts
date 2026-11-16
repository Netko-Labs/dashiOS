/**
 * "What I know about you" (persona/lib/about.ts; decisions.md D151): a
 * plain file the person reads and edits, given at the start of each
 * conversation, and written only when the person says "remember that…":
 * their own words, one line, with no model asked.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asksRemember } from "../src/agents/assistant/lib/words.ts";
import { ABOUT_MAX, aboutPath, ensureAbout, readAbout, rememberAbout } from "../src/persona/lib/about.ts";
import { aboutWords } from "../src/settings-app/lib/panes/persona-about.tsx";
import { fakeAssistant } from "./support/assistant.ts";

test("“remember that…” is the person's own words about themselves; a reminder or a question is not", () => {
  expect(asksRemember("Remember that I go to Bodytech on Mondays.")).toBe("I go to Bodytech on Mondays");
  expect(asksRemember("Please remember my platform is called Netko")).toBe("My platform is called Netko");
  expect(asksRemember("Recuerda que me llamo Pe")).toBe("Me llamo Pe");
  expect(asksRemember("remember to call me Pe")).toBe("To call me Pe");
  for (const other of ["Remember to buy milk", "Can you remember what I said before?", "remember that", "Do you remember the site?"])
    expect(asksRemember(other)).toBeNull();
});

test("the file: made when first opened, a line added each time, read back cut to size, and the person's own lines kept", () => {
  const path = join(mkdtempSync(join(tmpdir(), "about-")), "dashi", "about-you.md");
  expect(aboutPath({ HOME: "/home/alexk" })).toBe("/home/alexk/.config/dashi/about-you.md");
  expect(readAbout(path)).toBe("");
  expect(ensureAbout(path)).toBe(path);
  writeFileSync(path, "Call me Pe.");
  expect(rememberAbout("  I go to Bodytech\non Mondays ", path)).toBe(true);
  expect(readFileSync(path, "utf8")).toBe("Call me Pe.\n- I go to Bodytech on Mondays\n");
  expect(rememberAbout("   ", path)).toBe(false);
  expect(readAbout(path)).toBe("Call me Pe.\n- I go to Bodytech on Mondays");
  expect(aboutWords(readAbout(path))).toBe("2 lines");
  expect(aboutWords("")).toBe("Nothing yet");
  writeFileSync(path, "x".repeat(ABOUT_MAX + 500));
  expect(readAbout(path)).toHaveLength(ABOUT_MAX);
});

test("said to Dashi, it is written down and no model is asked; without a place to write, the model hears it", async () => {
  const kept: string[] = [];
  const fake = fakeAssistant([{ say: "never" }], { remember: (fact) => kept.push(fact) > 0 });
  expect(await fake.ask("Remember that I go to Bodytech on Mondays.")).toEqual({ say: "I'll remember that." });
  expect(kept).toEqual(["I go to Bodytech on Mondays"]);
  expect(fake.sent).toHaveLength(0);
  const plain = fakeAssistant([{ say: "I can't keep that." }]);
  await plain.ask("Remember that I go to Bodytech on Mondays.");
  expect(plain.sent).toHaveLength(1);
});
