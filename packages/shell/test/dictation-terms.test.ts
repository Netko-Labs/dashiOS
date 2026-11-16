/** Names and terms by rule (src/dictation/lib/rules-terms.ts): replacements, heard-as forms, near misses, dropped contractions. */

import { expect, test } from "bun:test";
import { NO_WORDS, wordsFrom } from "../src/dictation/index.ts";
import { applyTerms, likeness, nearTerm } from "../src/dictation/lib/rules-terms.ts";
import { OWN_TERMS } from "../src/dictation/lib/seed.ts";

const WORDS = wordsFrom([
  "the\ndash\ndead\ncloud\ncode\nwhisper\nflow\nagent\nfast\nschnell\nshould/D\nlike/S\ndot\nwant\nI\nAlex\nstart/SDG\nmake/SG\nstop/SDG",
]);
const lexical = { terms: OWN_TERMS, replacements: [{ from: "t three code", to: "T3 Code" }] };
const fix = (text: string, words = WORDS) => applyTerms(text, lexical, words);

test("a heard-as form and a replacement become the written form, whole words, any capitals, the longest first", () => {
  expect(fix("I use cloud code every day.")).toEqual({ text: "I use Claude Code every day.", fixes: 1 });
  expect(fix("Cloud Code, and the dead dash agent")).toEqual({ text: "Claude Code, and the Dashi agent", fixes: 2 });
  expect(fix("the dashy agent's name")).toEqual({ text: "the Dashi agent's name", fixes: 1 });
  expect(fix("open t three code")).toEqual({ text: "open T3 Code", fixes: 1 });
  // Not inside another word, and not across a mark.
  expect(fix("a cloud, code or not").fixes).toBe(0);
  expect(fix("clouds code").fixes).toBe(0);
});

test("a term takes its own capitals, and a possessive stays", () => {
  expect(fix("ask siri about dashi's dock").text).toBe("ask Siri about Dashi's dock");
  expect(fix("Dashi is here").fixes).toBe(0);
});

test("a word that is no word and is nearly a term becomes it; a real word never does", () => {
  expect(fix("like Whisperflow does").text).toBe("like Wispr Flow does");
  expect(fix("a dash of code").fixes).toBe(0);
  expect(nearTerm("heliun", OWN_TERMS, WORDS)).toBe("Helium");
  expect(nearTerm("schnell", [{ term: "Schnee", heard: [] }], WORDS)).toBeNull();
  expect(likeness("dashy", "dashi")).toBeCloseTo(0.8);
  // With no dictionary only a very near miss counts.
  expect(nearTerm("dashy", OWN_TERMS, NO_WORDS)).toBeNull();
  expect(nearTerm("Parakeat", OWN_TERMS, NO_WORDS)).toBe("Parakeet");
});

test("a contraction that lost its ending gets it back", () => {
  expect(fix("it shouldt have that").text).toBe("it shouldn't have that");
  expect(fix("Didnt we say so").text).toBe("Didn't we say so");
  expect(fix("I dot like it").text).toBe("I don't like it");
  expect(fix("put a dot like this").fixes).toBe(0);
});

test("the dictionary knows a word by its endings, and names apart from ordinary words", () => {
  expect(WORDS.known("starting")).toBe(true);
  expect(WORDS.known("stopped")).toBe(true);
  expect(WORDS.known("making")).toBe(true);
  expect(WORDS.known("idead")).toBe(false);
  expect(WORDS.common("alex")).toBe(false);
  expect(WORDS.known("alex")).toBe(true);
});
