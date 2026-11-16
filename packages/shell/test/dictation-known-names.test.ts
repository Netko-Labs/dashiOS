/**
 * The names the computer knows (dictation/lib/seed.ts, boot/known-names.ts, D198): installed apps, project folders and
 * allowed sites are written as the vocabulary is, never into its file, and what Dashi's assistant hears is spelled
 * with them and the person's replacements ("D tree code" → "T3 Code"); its context names them.
 */

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contextBlock, type Moment } from "../src/agents/assistant/context.ts";
import { allowedSites } from "../src/agents/sites.ts";
import { knownNames } from "../src/boot/index.ts";
import { knownTerms, Lexicon, wordsFrom } from "../src/dictation/index.ts";

const words = wordsFrom(["body\ntech\nmeeting\ndeveloper\ndocuments\nmusic\nnotes\nexperience"]);

test("folders and sites become names; ordinary words, versions and short ones do not", () => {
  const terms = knownTerms(
    {
      apps: ["Notes", "OBS Studio"],
      folders: ["mirin", "dashiOS", "Documents", "v09", "smoke-0.9", "Music"],
      sites: ["bodytech.com.co", "github.com", "192.168.1.1"],
    },
    words,
  );
  expect(terms.map((each) => each.term)).toEqual(["OBS Studio", "dashiOS", "Bodytech", "Github"]);
  // "mirin" is Dashi's own already.
  expect(terms.some((each) => each.term === "mirin")).toBe(false);
  expect(terms.find((each) => each.term === "Bodytech")?.heard).toEqual(["body tech"]);
});

test("the home's top folders and the top of ~/Developer, and every site allowed, are looked up", () => {
  const home = mkdtempSync(join(tmpdir(), "dashi-known-"));
  for (const dir of ["Developer/mirin", "Developer/dashiOS", "Documents/deep/inner", ".hidden"]) mkdirSync(join(home, dir), { recursive: true });
  const names = knownNames(() => ["Helium"], home)();
  expect([...names.folders].sort()).toEqual(["Developer", "Documents", "dashiOS", "mirin"]);
  expect(names.apps).toEqual(["Helium"]);
  const sites = join(home, "sites.json");
  writeFileSync(sites, JSON.stringify({ version: 1, agents: { a: { "bodytech.com.co": 1 } }, person: { "youtube.com": 1 } }));
  expect(allowedSites(sites)).toEqual(["youtube.com", "bodytech.com.co"]);
  expect(allowedSites(join(home, "none.json"))).toEqual([]);
});

test("what the assistant hears is spelled with the vocabulary and the replacements; the file keeps only the person's", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "dashi-lexicon-")), "dictation");
  const lexicon = new Lexicon({ dir, words, known: () => ({ apps: [], folders: ["mirin"], sites: ["bodytech.com.co"] }) });
  expect(lexicon.spell("open d tree code and book a class at body tech")).toBe("open T3 Code and book a class at Bodytech");
  expect(lexicon.spell("ask cloud code about it")).toBe("ask Claude Code about it");
  expect(lexicon.names()).toEqual(expect.arrayContaining(["T3 Code", "mirin", "Bodytech"]));
  const file = readFileSync(join(dir, "vocabulary"), "utf8");
  expect(file).not.toContain("Bodytech");
  expect(lexicon.getSnapshot().vocabulary.some((each) => each.term === "Bodytech")).toBe(false);
});

test("the context names the person's words, the apps left to their own line, at most sixty", () => {
  const moment: Moment = {
    window: null,
    selection: null,
    time: new Date(2026, 10, 15, 21, 0),
    language: "en_US",
    desktop: null,
    apps: ["Helium", "OBS Studio"],
    names: ["Dashi", "Helium", "T3 Code", "Bodytech", "mirin", ...Array.from({ length: 80 }, (_, at) => `Name${at}`)],
    talk: "Answer briefly.",
    about: "",
  };
  const block = contextBlock(moment, { fresh: true });
  expect(block).toContain("The person uses: Dashi, T3 Code, Bodytech, mirin, Name0");
  expect(block).not.toContain("Name56,");
});
